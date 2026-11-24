import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { InboxItem, InboxItemType } from '@/lib/db/schema/inbox'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { listProjectNamesInOrg } from '@/lib/projects/repository'
import { resolvePeople } from '@/lib/sharing/directory'
import { INBOX_LIST_LIMIT, listInboxItems, listUnreadAnchors } from './repository'
import { withLiveCounts } from './live-counts'
import {
  canonicalInboxType,
  type InboxItemView,
  type InboxListFilter,
  type InboxListResponse,
  type InboxSummaryResponse,
} from './types'
import { decodeInboxCursor, encodeInboxCursor, microsOf, newestFirst } from './inbox-cursor'
import { countFiltersAcross, countPendingAcross, inLane, lanesFor } from './inbox-lanes'
import { markAnswersFor } from './inbox-answer-places'
import { toItemView } from './inbox-item-view'
import { resolveTargets, rowsWithUnreadableRuns } from './inbox-target-access'
import type { InboxTargetAccess } from './targets'

export interface ListInboxParams {
  filter?: InboxListFilter
  cursor?: string | null
  type?: InboxItemType
  projectId?: string
  limit?: number
}

export async function listInbox(
  session: AuthorizedSession,
  params: ListInboxParams = {},
): Promise<InboxListResponse> {
  const filter: InboxListFilter = params.filter ?? 'all'
  const cursor = params.cursor ? decodeInboxCursor(params.cursor) : null
  const pageSize = Math.min(Math.max(1, Math.trunc(params.limit ?? INBOX_LIST_LIMIT)), INBOX_LIST_LIMIT)
  const lanes = await lanesFor(session)
  const listed = params.type
    ? lanes.map((lane) => ({ ...lane, types: lane.types.filter((type) => type === params.type) }))
    : lanes
  const perLane = await Promise.all(
    listed.map((lane) =>
      inLane(session, lane, () =>
        listInboxItems(lane.organizationId, session.userId, {
          filter,
          cursor,
          limit: pageSize + 1,
          types: lane.types,
          projectId: params.projectId,
        }),
      ),
    ),
  )
  const merged = perLane.flat().sort(newestFirst)
  const rows = merged.slice(0, pageSize)
  const hasMore = merged.length > pageSize
  const last = rows.at(-1)

  const actorIds = [...new Set(rows.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])))]

  const [targets, withheld, people, pending, counts] = await Promise.all([
    resolveTargets(session, rows),
    rowsWithUnreadableRuns(session, rows),
    resolvePeople(session.organizationId, actorIds),
    countPendingAcross(session, lanes),
    countFiltersAcross(session, lanes),
  ])

  const actorNames = new Map([...people].map(([userId, person]) => [userId, person.name]))
  const answers = await markAnswersFor(session, rows, targets)
  const projectNames = await listProjectNamesInOrg(session.organizationId, projectIdsOf(targets))

  return {
    items: await withLiveCounts(rows.map((row) => toItemView(row, targets, actorNames, withheld, answers, projectNames))),
    pending,
    counts,
    hasMore,
    nextCursor: hasMore && last ? encodeInboxCursor({ micros: microsOf(last).toString(), id: last.id }) : null,
  }
}

function projectIdsOf(targets: ReadonlyMap<string, InboxTargetAccess | null>): string[] {
  const ids = new Set<string>()
  for (const access of targets.values()) if (access?.projectId) ids.add(access.projectId)
  return [...ids]
}

export async function viewInboxItemAs(session: AuthorizedSession, row: InboxItem): Promise<InboxItemView | null> {
  const lanes = await lanesFor(session)
  const itemType = canonicalInboxType(row.type)
  if (!lanes.some((lane) => lane.organizationId === row.organizationId && lane.types.includes(itemType))) return null
  const [targets, withheld, people] = await Promise.all([
    resolveTargets(session, [row]),
    rowsWithUnreadableRuns(session, [row]),
    resolvePeople(session.organizationId, row.actorUserId ? [row.actorUserId] : []),
  ])
  const actorNames = new Map([...people].map(([userId, person]) => [userId, person.name]))
  const projectNames = await listProjectNamesInOrg(session.organizationId, projectIdsOf(targets))
  const view = toItemView(row, targets, actorNames, withheld, await markAnswersFor(session, [row], targets), projectNames)
  return view.href ? (await withLiveCounts([view]))[0] : null // counted only once the target is reachable
}

export async function getInboxSummary(session: AuthorizedSession): Promise<InboxSummaryResponse> {
  return { pending: await countPendingAcross(session, await lanesFor(session)) }
}

export async function unreadAnchorsFor(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<{ anchorIds: string[] }> {
  const lanes = await lanesFor(session)
  const perLane = await Promise.all(
    lanes.map((lane) =>
      inLane(session, lane, () =>
        listUnreadAnchors(lane.organizationId, session.userId, resourceType, resourceId, lane.types),
      ),
    ),
  )
  return { anchorIds: [...new Set(perLane.flat())] }
}
