import { Forbidden, type Access, type CollectionBeforeOperationHook, type Where } from 'payload';
import { canDraft, canPublish, roleOf, type Principal } from './roles';

export function livePosts(now: Date): Where {
  return { and: [{ _status: { equals: 'published' } }, { publishedAt: { less_than_equal: now.toISOString() } }] };
}

type StatusData = { _status?: unknown } | null | undefined;

export function mayWrite(user: Principal, data: StatusData): boolean {
  return data?._status === 'published' ? canPublish(user) : canDraft(user);
}

export const readPosts: Access = ({ req }) => {
  if (canDraft(req.user)) return true;
  const role = roleOf(req.user);
  if (role === 'website' || role === 'social-handoff') return livePosts(new Date());
  return false;
};

export const writePosts: Access = ({ req, data }) => mayWrite(req.user, data as StatusData);

export const deletePosts: Access = ({ req }) => canPublish(req.user);

export const readPostVersions: Access = ({ req }) => canDraft(req.user);

const WRITES = new Set(['create', 'update', 'restoreVersion']);

export const draftsUnlessPublisher: CollectionBeforeOperationHook = ({ args, operation, overrideAccess, req }) => {
  if (!WRITES.has(operation) || overrideAccess || canPublish(req.user)) return args;
  if (!canDraft(req.user)) throw new Forbidden(req.t);
  const data = (args as { data?: StatusData }).data;
  if (data?._status === 'published') throw new Forbidden(req.t);
  if (operation === 'restoreVersion' && !(args as { draft?: boolean }).draft) throw new Forbidden(req.t);
  return {
    ...args,
    draft: true,
    publishAllLocales: false,
    publishSpecificLocale: undefined,
    unpublishAllLocales: false,
  } as typeof args;
};
