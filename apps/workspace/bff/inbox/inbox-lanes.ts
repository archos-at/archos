import 'server-only'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import { isCollaborationEnabled } from '@/lib/authz/feature-flags'
import { getPlatformOrganizationId, hasPlatformPermission } from '@/lib/authz/platform'
import type { InboxItemType } from '@/lib/db/schema/inbox'
import { withTenant } from '@/lib/db/tenant-context'
import { countInboxFilters, countPendingInboxItems } from './repository'
import { PLATFORM_INBOX_PERMISSION, platformInboxTypes, visibleInboxTypes } from './registry'
import type { InboxListResponse } from './types'

function typesVisibleTo(session: Pick<UserSession, 'featureFlags'>): InboxItemType[] {
  return visibleInboxTypes(isCollaborationEnabled(session))
}

export interface InboxLane {
  organizationId: string
  types: InboxItemType[]
}

async function platformLaneFor(session: AuthorizedSession): Promise<InboxLane | null> {
  const types = platformInboxTypes()
  if (types.length === 0) return null
  if (!(await hasPlatformPermission(session, PLATFORM_INBOX_PERMISSION))) return null
  const organizationId = await getPlatformOrganizationId()
  return organizationId ? { organizationId, types } : null
}

export async function lanesFor(session: AuthorizedSession): Promise<InboxLane[]> {
  const tenant: InboxLane = { organizationId: session.organizationId, types: typesVisibleTo(session) }
  const platform = await platformLaneFor(session)
  return platform ? [tenant, platform] : [tenant]
}

export function inLane<T>(session: AuthorizedSession, lane: InboxLane, fn: () => Promise<T>): Promise<T> {
  if (lane.organizationId === session.organizationId) return fn()
  return withTenant({ organizationId: lane.organizationId, userId: session.userId }, fn)
}

export async function countPendingAcross(session: AuthorizedSession, lanes: readonly InboxLane[]): Promise<number> {
  const counts = await Promise.all(
    lanes.map((lane) =>
      inLane(session, lane, () => countPendingInboxItems(lane.organizationId, session.userId, lane.types)),
    ),
  )
  return counts.reduce((sum, value) => sum + value, 0)
}

export async function mutateAcross(
  session: AuthorizedSession,
  lanes: readonly InboxLane[],
  mutate: (lane: InboxLane) => Promise<number>,
): Promise<number> {
  const affected = await Promise.all(lanes.map((lane) => inLane(session, lane, () => mutate(lane))))
  return affected.reduce((sum, value) => sum + value, 0)
}

export async function countFiltersAcross(
  session: AuthorizedSession,
  lanes: readonly InboxLane[],
): Promise<InboxListResponse['counts']> {
  const counts = await Promise.all(
    lanes.map((lane) =>
      inLane(session, lane, () => countInboxFilters(lane.organizationId, session.userId, lane.types)),
    ),
  )
  return counts.reduce(
    (sum, value) => ({ requests: sum.requests + value.requests, unread: sum.unread + value.unread }),
    { requests: 0, unread: 0 },
  )
}
