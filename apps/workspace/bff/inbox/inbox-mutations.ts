import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { publishToUser } from '@/lib/events/bus'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { MARKS_SET_GROUP_ANCHOR } from './registry'
import {
  archiveInboxItem,
  markAllInboxItemsRead,
  markAnchorItemsRead,
  markInboxItemsRead,
  markInboxItemsUnread,
  markResourceItemsRead,
  unarchiveInboxItem,
} from './repository'
import { countPendingAcross, lanesFor, mutateAcross, type InboxLane } from './inbox-lanes'
import type { InboxMutationResult } from './types'

async function publishPending(
  session: AuthorizedSession,
  lanes: readonly InboxLane[],
  affected: number,
): Promise<InboxMutationResult> {
  const pending = await countPendingAcross(session, lanes)
  await publishToUser(session.userId, { kind: 'inbox.changed', pending })
  return { affected, pending }
}

export async function markRead(
  session: AuthorizedSession,
  itemIds: readonly string[],
): Promise<InboxMutationResult> {
  const lanes = await lanesFor(session)
  const affected = await mutateAcross(session, lanes, (lane) =>
    markInboxItemsRead(lane.organizationId, session.userId, [...itemIds], lane.types),
  )
  return publishPending(session, lanes, affected)
}

export async function markAllRead(session: AuthorizedSession): Promise<InboxMutationResult> {
  const lanes = await lanesFor(session)
  const affected = await mutateAcross(session, lanes, (lane) =>
    markAllInboxItemsRead(lane.organizationId, session.userId, lane.types),
  )
  return publishPending(session, lanes, affected)
}

export async function archiveItem(session: AuthorizedSession, itemId: string): Promise<InboxMutationResult> {
  const lanes = await lanesFor(session)
  const archived = await mutateAcross(session, lanes, async (lane) =>
    (await archiveInboxItem(lane.organizationId, session.userId, itemId, lane.types)) ? 1 : 0,
  )
  if (archived === 0) throw new NotFoundError()
  return publishPending(session, lanes, archived)
}

export async function markUnread(
  session: AuthorizedSession,
  itemIds: readonly string[],
): Promise<InboxMutationResult> {
  const lanes = await lanesFor(session)
  const affected = await mutateAcross(session, lanes, (lane) =>
    markInboxItemsUnread(lane.organizationId, session.userId, [...itemIds], lane.types),
  )
  return publishPending(session, lanes, affected)
}

export async function unarchiveItem(session: AuthorizedSession, itemId: string): Promise<InboxMutationResult> {
  const lanes = await lanesFor(session)
  const restored = await mutateAcross(session, lanes, async (lane) =>
    (await unarchiveInboxItem(lane.organizationId, session.userId, itemId, lane.types)) ? 1 : 0,
  )
  if (restored === 0) throw new NotFoundError()
  return publishPending(session, lanes, restored)
}

export async function markResourceItemsReadFor(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<InboxMutationResult> {
  const affected = await markResourceItemsRead(
    session.organizationId,
    session.userId,
    resourceType,
    resourceId,
  )
  return publishPending(session, await lanesFor(session), affected)
}

export async function markAnchorItemsReadFor(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  anchorId: string,
): Promise<InboxMutationResult> {
  const lanes = await lanesFor(session)
  const affected = await mutateAcross(session, lanes, (lane) =>
    markAnchorItemsRead(lane.organizationId, session.userId, resourceType, resourceId, anchorId, lane.types),
  )
  if (affected === 0) return { affected, pending: await countPendingAcross(session, lanes) }
  return publishPending(session, lanes, affected)
}

export async function markMarksSetReadFor(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<InboxMutationResult> {
  const lanes = await lanesFor(session)
  const affected = await mutateAcross(session, lanes, (lane) =>
    markResourceItemsRead(lane.organizationId, session.userId, resourceType, resourceId, {
      groupAnchor: MARKS_SET_GROUP_ANCHOR,
      types: lane.types,
    }),
  )
  if (affected === 0) return { affected, pending: await countPendingAcross(session, lanes) }
  return publishPending(session, lanes, affected)
}
