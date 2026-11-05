/**
 * The approval step for social posts (ADR-0155): nothing goes to Buffer that a
 * person has not approved. A social post has no drafts and versions of the
 * blog's kind; its `status` is the workflow, and who may move it where is this
 * table, checked on every write (`guardSocialStatus`).
 */
import { Forbidden, type Access, type CollectionBeforeChangeHook, type FieldAccess } from 'payload';
import { canDraft, canPublish, roleOf, type Principal } from './roles';

export const SOCIAL_STATUSES = ['draft', 'in_review', 'approved', 'scheduled', 'published', 'failed', 'archived'] as const;
export type SocialStatus = (typeof SOCIAL_STATUSES)[number];

/** What a drafter may touch: their own work before approval, and a post that failed to go out. */
const DRAFTER_FROM: readonly (SocialStatus | undefined)[] = [undefined, 'draft', 'in_review', 'failed'];
const DRAFTER_TO: readonly SocialStatus[] = ['draft', 'in_review'];
/** The hand-off moves an approved post on, and nothing else. */
const HANDOFF_TO: readonly SocialStatus[] = ['scheduled', 'failed'];

/** Whether `user` may move a social post from `from` (undefined: a new post) to `to`. */
export function socialStatusAllowed(user: Principal, from: SocialStatus | undefined, to: SocialStatus): boolean {
  if (canPublish(user)) return true;
  if (canDraft(user)) return DRAFTER_FROM.includes(from) && DRAFTER_TO.includes(to);
  if (roleOf(user) === 'social-handoff') return from === 'approved' && HANDOFF_TO.includes(to);
  return false;
}

export const readSocialPosts: Access = ({ req }) => {
  if (canDraft(req.user)) return true;
  if (roleOf(req.user) === 'social-handoff') return { status: { in: ['approved', 'scheduled', 'failed'] } };
  return false;
};

export const createSocialPosts: Access = ({ req }) => canDraft(req.user);

export const updateSocialPosts: Access = ({ req }) => {
  if (canPublish(req.user)) return true;
  if (canDraft(req.user)) return { status: { in: ['draft', 'in_review', 'failed'] } };
  if (roleOf(req.user) === 'social-handoff') return { status: { equals: 'approved' } };
  return false;
};

export const deleteSocialPosts: Access = ({ req }) => canPublish(req.user);

/** Fields the hand-off may not write: everything but what it records. */
export const notByHandoff: FieldAccess = ({ req }) => roleOf(req.user) !== 'social-handoff';

export const guardSocialStatus: CollectionBeforeChangeHook = ({ data, originalDoc, operation, req }) => {
  if (!req.user) return data;
  const from = operation === 'create' ? undefined : (originalDoc?.status as SocialStatus | undefined);
  const to = (data.status ?? from ?? 'draft') as SocialStatus;
  if (from === to && operation === 'update' && roleOf(req.user) !== 'social-handoff') return data;
  if (!socialStatusAllowed(req.user, from, to)) throw new Forbidden(req.t);
  return data;
};
