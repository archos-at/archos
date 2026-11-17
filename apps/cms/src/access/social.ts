import { sql } from '@payloadcms/db-postgres';
import { APIError, Forbidden, type Access, type CollectionBeforeChangeHook, type FieldAccess, type PayloadRequest } from 'payload';
import { canDraft, canPublish, roleOf, type Principal } from './roles';

export const SOCIAL_STATUSES = ['draft', 'in_review', 'approved', 'sending', 'scheduled', 'published', 'failed', 'archived'] as const;
export type SocialStatus = (typeof SOCIAL_STATUSES)[number];

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
export const SOCIAL_INITIAL: readonly SocialStatus[] = ['draft', 'in_review', 'approved', 'published'];

export const HANDED_OVER: readonly SocialStatus[] = ['sending', 'scheduled', 'published'];

export function socialMoveExists(from: SocialStatus | undefined, to: SocialStatus): boolean {
  return from === undefined ? SOCIAL_INITIAL.includes(to) : SOCIAL_MOVES[from].includes(to);
}

const DRAFTER_FROM: readonly (SocialStatus | undefined)[] = [undefined, 'draft', 'in_review', 'failed'];
const DRAFTER_TO: readonly SocialStatus[] = ['draft', 'in_review'];
const HANDOFF_MOVES: Partial<Record<SocialStatus, readonly SocialStatus[]>> = {
  approved: ['sending'],
  sending: ['scheduled', 'failed'],
};
const HANDOFF_FROM = Object.keys(HANDOFF_MOVES) as SocialStatus[];

export function socialStatusAllowed(user: Principal, from: SocialStatus | undefined, to: SocialStatus): boolean {
  if (!socialMoveExists(from, to)) return false;
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

export const contentWritable: FieldAccess = ({ req, doc }) => {
  if (roleOf(req.user) === 'social-handoff') return false;
  return !HANDED_OVER.includes(doc?.status as SocialStatus);
};

export const notByHandoff: FieldAccess = ({ req }) => roleOf(req.user) !== 'social-handoff';

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
