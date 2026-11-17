/**
 * The approval step for social posts (ADR-0155): nothing goes to Buffer that a
 * person has not approved, and nothing goes there twice. A social post has no
 * drafts and versions of the blog's kind; its `status` is the workflow. Which
 * moves exist is `SOCIAL_MOVES`, who may make each is `socialStatusAllowed`,
 * and both are checked on every write against the status read under a row lock
 * (`guardSocialStatus`).
 */
import { sql } from '@payloadcms/db-postgres';
import { APIError, Forbidden, type Access, type CollectionBeforeChangeHook, type FieldAccess, type PayloadRequest } from 'payload';
import { canDraft, canPublish, roleOf, type Principal } from './roles';

export const SOCIAL_STATUSES = ['draft', 'in_review', 'approved', 'sending', 'scheduled', 'published', 'failed', 'archived'] as const;
export type SocialStatus = (typeof SOCIAL_STATUSES)[number];

/**
 * The post's lifecycle: every status it may become from each one. The same
 * table as `defineLifecycle` of apps/workspace takes (ADR-0179), written as a
 * plain record because the CMS is its own package and imports nothing from the
 * workspace.
 *
 * `sending` is the hand-off's claim: it is written before the post goes to
 * Buffer, so a run that dies between the send and the record leaves a status
 * the next run reads and reconciles, never an `approved` post to send again.
 * From `sending` on the post is at Buffer, so no move leads back to `approved`
 * except through `failed`, which a person sets knowing what Buffer holds.
 */
export const SOCIAL_MOVES: Readonly<Record<SocialStatus, readonly SocialStatus[]>> = {
  draft: ['in_review', 'approved', 'published', 'archived'],
  in_review: ['draft', 'approved', 'published', 'archived'],
  approved: ['draft', 'in_review', 'sending', 'published', 'archived'],
  sending: ['scheduled', 'failed', 'archived'],
  scheduled: ['published', 'failed', 'archived'],
  published: ['archived'],
  failed: ['draft', 'in_review', 'approved', 'archived'],
  archived: ['draft'],
};
/** What a new post may start as. `published` records a post a person put out by hand. */
export const SOCIAL_INITIAL: readonly SocialStatus[] = ['draft', 'in_review', 'approved', 'published'];

/** Statuses in which Buffer holds, or is being given, the post: its content is what went there. */
export const HANDED_OVER: readonly SocialStatus[] = ['sending', 'scheduled', 'published'];

/** Whether the lifecycle has the move at all, whoever asks (`from` undefined: a new post). */
export function socialMoveExists(from: SocialStatus | undefined, to: SocialStatus): boolean {
  return from === undefined ? SOCIAL_INITIAL.includes(to) : SOCIAL_MOVES[from].includes(to);
}

/** What a drafter may touch: their own work before approval, and a post that failed to go out. */
const DRAFTER_FROM: readonly (SocialStatus | undefined)[] = [undefined, 'draft', 'in_review', 'failed'];
const DRAFTER_TO: readonly SocialStatus[] = ['draft', 'in_review'];
/** The hand-off claims an approved post, then records what Buffer answered, and nothing else. */
const HANDOFF_MOVES: Partial<Record<SocialStatus, readonly SocialStatus[]>> = {
  approved: ['sending'],
  sending: ['scheduled', 'failed'],
};
/** The statuses the hand-off may write from. */
const HANDOFF_FROM = Object.keys(HANDOFF_MOVES) as SocialStatus[];

/** Whether `user` may move a social post from `from` (undefined: a new post) to `to`. */
export function socialStatusAllowed(user: Principal, from: SocialStatus | undefined, to: SocialStatus): boolean {
  if (!socialMoveExists(from, to)) return false;
  // Only the hand-off claims and only it records a hand-over: a person who set either would name a Buffer post that does not exist.
  if (roleOf(user) === 'social-handoff') return from !== undefined && (HANDOFF_MOVES[from]?.includes(to) ?? false);
  if (to === 'sending' || to === 'scheduled') return false;
  if (canPublish(user)) return true;
  if (canDraft(user)) return DRAFTER_FROM.includes(from) && DRAFTER_TO.includes(to);
  return false;
}

export const readSocialPosts: Access = ({ req }) => {
  if (canDraft(req.user)) return true;
  if (roleOf(req.user) === 'social-handoff') return { status: { in: [...HANDOFF_FROM, 'scheduled', 'failed'] } };
  return false;
};

export const createSocialPosts: Access = ({ req }) => canDraft(req.user);

export const updateSocialPosts: Access = ({ req }) => {
  if (canPublish(req.user)) return true;
  if (canDraft(req.user)) return { status: { in: ['draft', 'in_review', 'failed'] } };
  if (roleOf(req.user) === 'social-handoff') return { status: { in: HANDOFF_FROM } };
  return false;
};

export const deleteSocialPosts: Access = ({ req }) => canPublish(req.user);

/**
 * What the post says and when: writable by people, and only until the post is
 * handed over. After that Buffer holds a copy nothing here updates, so an edit
 * would make the CMS show a text that is not the one going out. To change a
 * handed-over post, change or delete it in Buffer and set it `failed` here.
 */
export const contentWritable: FieldAccess = ({ req, doc }) => {
  if (roleOf(req.user) === 'social-handoff') return false;
  return !HANDED_OVER.includes(doc?.status as SocialStatus);
};

/** Fields the hand-off records and a person does not set (the collection's `sourceRef`). */
export const notByHandoff: FieldAccess = ({ req }) => roleOf(req.user) !== 'social-handoff';

/**
 * The post's status as the database holds it now, with its row locked until
 * this request's transaction ends. Payload reads a document, runs the hooks and
 * then writes by id, so two requests can both read `approved`; the lock makes
 * the second wait and then see what the first wrote. Without it two runs of the
 * hand-off could both claim one post and both send it.
 */
async function lockedStatus(req: PayloadRequest, id: number | string): Promise<SocialStatus | undefined> {
  const db = req.payload.db;
  const transactionId = await req.transactionID;
  const session = transactionId === undefined ? undefined : db.sessions?.[transactionId];
  const executor = (session?.db ?? db.drizzle) as { execute: (query: unknown) => Promise<{ rows: { status?: SocialStatus }[] }> };
  const { rows } = await executor.execute(sql`select status from social_posts where id = ${id} for update`);
  return rows[0]?.status;
}

export const guardSocialStatus: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  if (!req.user) return data;
  const from = operation === 'create' ? undefined : await lockedStatus(req, originalDoc.id);
  const to = (data.status ?? from ?? 'draft') as SocialStatus;
  if (operation === 'update' && from !== originalDoc.status) {
    throw new APIError(`The post became ${from} while this change was on its way. Reload it.`, 409, null, true);
  }
  if (from === to && operation === 'update' && roleOf(req.user) !== 'social-handoff') return data;
  if (!socialStatusAllowed(req.user, from, to)) throw new Forbidden(req.t);
  return data;
};
