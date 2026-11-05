/**
 * The review step for blog posts (ADR-0155), enforced on every path a write can
 * take: the admin panel, REST, GraphQL, the Local API, the MCP plugin and the
 * scheduled-publish job all run the same operations, so the rules sit on the
 * collection, not in a UI.
 *
 * 1. Only `canPublish` may make a version live, take one down, or delete.
 * 2. Everyone else who may draft writes drafts, and only drafts: the
 *    `beforeOperation` hook turns every create, update and restore of theirs into
 *    a draft save, which Payload writes to the versions table alone. The live
 *    document is untouched, so an editor's or an agent's change to a published
 *    post waits as its newest draft until a publisher publishes it. A request
 *    that asks to publish (`_status: 'published'`) is refused, not downgraded.
 * 3. The website reads what is live: published, with a publish date that has
 *    passed. A post's body is part of the post (Payload's blocks are fields, not
 *    separate items), so there is no block an API client could change on its own
 *    behind the review.
 */
import { Forbidden, type Access, type CollectionBeforeOperationHook, type Where } from 'payload';
import { canDraft, canPublish, roleOf, type Principal } from './roles';

/** The posts the website may read: published, and due. */
export function livePosts(now: Date): Where {
  return { and: [{ _status: { equals: 'published' } }, { publishedAt: { less_than_equal: now.toISOString() } }] };
}

type StatusData = { _status?: unknown } | null | undefined;

/** Whether `user` may write `data`: a publication only by a publisher, a draft by anyone who drafts. */
export function mayWrite(user: Principal, data: StatusData): boolean {
  return data?._status === 'published' ? canPublish(user) : canDraft(user);
}

export const readPosts: Access = ({ req }) => {
  if (canDraft(req.user)) return true;
  const role = roleOf(req.user);
  if (role === 'website' || role === 'social-handoff') return livePosts(new Date());
  return false;
};

/** Create and update: the admin panel asks with `_status: 'published'` to decide whether to show Publish. */
export const writePosts: Access = ({ req, data }) => mayWrite(req.user, data as StatusData);

export const deletePosts: Access = ({ req }) => canPublish(req.user);

export const readPostVersions: Access = ({ req }) => canDraft(req.user);

// restoreVersion reads its `draft` flag before this hook runs, so there the update access
// (`writePosts`) is what refuses an editor's restore of a published version; "restore as draft" works.
const WRITES = new Set(['create', 'update', 'restoreVersion']);

/**
 * Turns every write of a non-publisher into a draft save (rule 2). Skipped for
 * server code that overrides access on purpose (the import, a migration), which
 * runs as no one.
 */
export const draftsUnlessPublisher: CollectionBeforeOperationHook = ({ args, operation, overrideAccess, req }) => {
  if (!WRITES.has(operation) || overrideAccess || canPublish(req.user)) return args;
  if (!canDraft(req.user)) throw new Forbidden(req.t);
  const data = (args as { data?: StatusData }).data;
  if (data?._status === 'published') throw new Forbidden(req.t);
  return {
    ...args,
    draft: true,
    publishAllLocales: false,
    publishSpecificLocale: undefined,
    unpublishAllLocales: false,
  } as typeof args;
};
