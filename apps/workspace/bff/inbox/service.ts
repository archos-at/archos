import 'server-only'
import { BadRequestError, NotFoundError } from '@/lib/api/errors'
import { markMentionsSchema, type MarkMention } from '@/lib/annotations/types'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import { isCollaborationEnabled, isAgentWakesEnabled } from '@/lib/authz/feature-flags'
import { canWriteDocument } from '@/lib/documents/can-write'
import { getPlatformOrganizationId, hasPlatformPermission } from '@/lib/authz/platform'
import { withTenant } from '@/lib/db/tenant-context'
import { publishToUser } from '@/lib/events/bus'
import type { InboxItem, InboxItemType, InboxTargetType, NewInboxItem } from '@/lib/db/schema/inbox'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { enqueueInboxPushes } from '@/lib/push/enqueue'
import { listProjectNamesInOrg } from '@/lib/projects/repository'
import { resolvePeople } from '@/lib/sharing/directory'
import { unreadableRunIds, type RunRef } from '@/lib/tasks/subject-access'
import { parseUploadReport } from '@/lib/upload-batches/upload-report'
import { findInboxTarget, type InboxTargetAccess, type RunMessageRef } from './targets'
import { withLiveCounts } from './live-counts'
import {
  archiveInboxItem,
  countInboxFilters,
  countPendingInboxItems,
  INBOX_LIST_LIMIT,
  listInboxItems,
  listUnreadAnchors,
  markAllInboxItemsRead,
  markAnchorItemsRead,
  markInboxItemsRead,
  markInboxItemsUnread,
  markItemsInertAnchoredOn,
  markItemsInertForResource,
  markItemsInertForSubjectRow,
  markResourceItemsRead,
  openRecipientsOfGroup,
  resolveInboxItemsForTargets,
  resolveOpenItemsAnchoredOn,
  retractOccurrenceAnchoredOn,
  rewriteItemPayloadsAnchoredOn,
  unarchiveInboxItem,
  upsertInboxItems,
  type AnchoredRows,
  type InboxCursor,
  type InboxResolutionTarget,
} from './repository'
import {
  inboxItemIsActionable,
  PLATFORM_INBOX_PERMISSION,
  platformInboxTypes,
  visibleInboxTypes,
  MARKS_SET_GROUP_ANCHOR,
} from './registry'
import {
  canonicalInboxType,
  isMarkAnchored,
  type InboxAnswerPlace,
  type InboxItemState,
  type InboxItemView,
  type InboxListFilter,
  type InboxListResponse,
  type InboxMutationResult,
  type InboxSummaryResponse,
} from './types'

export interface InboxEmission {
  organizationId: string
  recipientUserId: string
  type: InboxItemType
  resourceType: InboxTargetType
  resourceId: string
  anchorId?: string | null
  actorUserId?: string | null
  groupKey: string
  payload?: Record<string, unknown>
  occurrences?: number
}

export function upsertWaves<T extends { recipientUserId: string; groupKey: string }>(rows: readonly T[]): T[][] {
  const waves: T[][] = []
  const seenByWave: Array<Set<string>> = []
  for (const row of rows) {
    const key = `${row.recipientUserId}\u0000${row.groupKey}`
    let index = seenByWave.findIndex((seen) => !seen.has(key))
    if (index < 0) {
      index = waves.length
      waves.push([])
      seenByWave.push(new Set())
    }
    waves[index].push(row)
    seenByWave[index].add(key)
  }
  return waves
}

export async function emitInboxItems(emissions: InboxEmission[]): Promise<number> {
  const rows: NewInboxItem[] = emissions
    .filter((emission) => emission.recipientUserId !== emission.actorUserId)
    .map((emission) => ({
      organizationId: emission.organizationId,
      recipientUserId: emission.recipientUserId,
      type: emission.type,
      resourceType: emission.resourceType,
      resourceId: emission.resourceId,
      anchorId: emission.anchorId ?? null,
      actorUserId: emission.actorUserId ?? null,
      groupKey: emission.groupKey,
      actionable: inboxItemIsActionable(emission.type),
      payload: emission.payload ?? {},
      count: Math.max(1, Math.floor(emission.occurrences ?? 1)),
    }))

  if (rows.length === 0) return 0

  const inserted = []
  for (const wave of upsertWaves(rows)) inserted.push(...(await upsertInboxItems(wave)))

  await enqueueInboxPushes(inserted)

  await Promise.all(
    [...new Set(rows.map((row) => row.recipientUserId))].map(async (recipientUserId) => {
      const emission = rows.find((row) => row.recipientUserId === recipientUserId)
      if (!emission) return
      await publishToUser(recipientUserId, {
        kind: 'inbox.changed',
        pending: -1,
        itemType: canonicalInboxType(emission.type) as InboxItemType,
      })
    }),
  )

  return inserted.length
}

export async function openRecipientsOf(organizationId: string, groupKey: string): Promise<string[]> {
  return openRecipientsOfGroup(organizationId, groupKey)
}

export async function resolveInboxItemsFor(
  targets: readonly InboxResolutionTarget[],
): Promise<number> {
  const resolved = await resolveInboxItemsForTargets(targets)
  await Promise.all(
    [...new Set(targets.map((target) => target.recipientUserId))].map((userId) =>
      publishToUser(userId, { kind: 'inbox.changed', pending: -1 }),
    ),
  )
  return resolved
}

export async function resolveInboxItemsAnchoredOn(input: {
  organizationId: string
  types: readonly InboxItemType[]
  anchorId: string
  recipientUserId?: string
}): Promise<number> {
  return nudge(await resolveOpenItemsAnchoredOn(input))
}

async function nudge(recipients: readonly string[]): Promise<number> {
  await Promise.all(recipients.map((userId) => publishToUser(userId, { kind: 'inbox.changed', pending: -1 })))
  return recipients.length
}

export async function markInboxItemsInertAnchoredOn(input: AnchoredRows): Promise<number> {
  return nudge(await markItemsInertAnchoredOn(input))
}

export async function retractInboxOccurrenceAnchoredOn(
  input: AnchoredRows & { clear: readonly string[]; inertWhenSpent: boolean }
): Promise<number> {
  return nudge(await retractOccurrenceAnchoredOn(input))
}

export async function rewriteInboxPayloadsAnchoredOn(input: AnchoredRows & { facts: Record<string, unknown> }): Promise<number> {
  return nudge(await rewriteItemPayloadsAnchoredOn(input))
}

export async function markItemsInertForSubject(
  resourceType: ShareableResourceType,
  resourceId: string,
  subjectUserId: string,
): Promise<number> {
  const affected = await markItemsInertForSubjectRow(resourceType, resourceId, subjectUserId)
  if (affected > 0) {
    await publishToUser(subjectUserId, { kind: 'inbox.changed', pending: -1 })
  }
  return affected
}

export async function markItemsInertForDeletedResource(
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<number> {
  return markItemsInertForResource(resourceType, resourceId)
}

export { INBOX_LIST_LIMIT }
export type { InboxResolutionTarget }

export interface ListInboxParams {
  filter?: InboxListFilter
  cursor?: string | null
  type?: InboxItemType
  projectId?: string
  limit?: number
}

export function encodeInboxCursor(cursor: InboxCursor): string {
  return Buffer.from(`${cursor.micros}|${cursor.id}`, 'utf8').toString('base64url')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function decodeInboxCursor(cursor: string): InboxCursor {
  const [micros, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  if (rest.length > 0 || !id || !UUID.test(id) || !micros || !/^\d{1,19}$/.test(micros)) {
    throw new BadRequestError('Invalid inbox cursor')
  }
  return { micros, id }
}

function microsOf(row: InboxItem & { listedAtMicros?: string }): bigint {
  return row.listedAtMicros ? BigInt(row.listedAtMicros) : BigInt(row.updatedAt.getTime()) * BigInt(1000)
}

function newestFirst(a: InboxItem, b: InboxItem): number {
  const ta = microsOf(a)
  const tb = microsOf(b)
  if (ta !== tb) return tb > ta ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

function targetKey(resourceType: InboxTargetType, resourceId: string): string {
  return `${resourceType}:${resourceId}`
}

function typesVisibleTo(session: Pick<UserSession, 'featureFlags'>): InboxItemType[] {
  return visibleInboxTypes(isCollaborationEnabled(session))
}

interface InboxLane {
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

async function lanesFor(session: AuthorizedSession): Promise<InboxLane[]> {
  const tenant: InboxLane = { organizationId: session.organizationId, types: typesVisibleTo(session) }
  const platform = await platformLaneFor(session)
  return platform ? [tenant, platform] : [tenant]
}

function inLane<T>(session: AuthorizedSession, lane: InboxLane, fn: () => Promise<T>): Promise<T> {
  if (lane.organizationId === session.organizationId) return fn()
  return withTenant({ organizationId: lane.organizationId, userId: session.userId }, fn)
}

async function countPendingAcross(session: AuthorizedSession, lanes: readonly InboxLane[]): Promise<number> {
  const counts = await Promise.all(
    lanes.map((lane) =>
      inLane(session, lane, () => countPendingInboxItems(lane.organizationId, session.userId, lane.types)),
    ),
  )
  return counts.reduce((sum, value) => sum + value, 0)
}

async function mutateAcross(
  session: AuthorizedSession,
  lanes: readonly InboxLane[],
  mutate: (lane: InboxLane) => Promise<number>,
): Promise<number> {
  const affected = await Promise.all(lanes.map((lane) => inLane(session, lane, () => mutate(lane))))
  return affected.reduce((sum, value) => sum + value, 0)
}

function deriveState(row: InboxItem): InboxItemState {
  if (row.inertAt) return 'inert'
  if (row.archivedAt) return 'archived'
  if (row.resolvedAt) return 'resolved'
  if (row.readAt) return 'read'
  return 'unread'
}

function coerceText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed
}

const SUBJECT_MAX_LENGTH = 200
const EXCERPT_MAX_LENGTH = 500

function coerceMentions(value: unknown): MarkMention[] {
  const parsed = markMentionsSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

function coerceVariant(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z_]{0,31}$/.test(value) ? value : null
}

function coerceDay(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function coerceCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : null
}

async function resolveTargets(
  session: AuthorizedSession,
  rows: readonly InboxItem[],
): Promise<Map<string, InboxTargetAccess | null>> {
  const distinct = new Map<string, { resourceType: InboxTargetType; resourceId: string }>()
  for (const row of rows) {
    if (row.inertAt) continue
    const key = targetKey(row.resourceType, row.resourceId)
    if (!distinct.has(key)) {
      distinct.set(key, { resourceType: row.resourceType, resourceId: row.resourceId })
    }
  }

  const resolved = await Promise.all(
    [...distinct].map(async ([key, target]) => {
      const descriptor = findInboxTarget(target.resourceType)
      if (!descriptor) return [key, null] as const
      try {
        return [key, await descriptor.resolve(session, target.resourceId)] as const
      } catch (error) {
        if (!(error instanceof NotFoundError)) {
          console.warn(`[inbox] re-authorization failed for ${key}, redacting item(s):`, error)
        }
        return [key, null] as const
      }
    }),
  )

  return new Map(resolved)
}

function runRefOf(row: InboxItem): RunRef | null {
  if (row.inertAt || row.resourceType !== 'project') return null
  const payload: Record<string, unknown> = row.payload ?? {}
  const runId = nonEmpty(payload.runId) ?? nonEmpty(payload.taskId)
  return runId ? { projectId: row.resourceId, runId } : null
}

async function rowsWithUnreadableRuns(session: AuthorizedSession, rows: readonly InboxItem[]): Promise<Set<string>> {
  const refs = rows.flatMap((row) => {
    const ref = runRefOf(row)
    return ref ? [{ rowId: row.id, ref }] : []
  })
  if (refs.length === 0) return new Set()
  const unreadable = await unreadableRunIds(
    session,
    refs.map(({ ref }) => ref),
  )
  return new Set(refs.filter(({ ref }) => unreadable.has(ref.runId)).map(({ rowId }) => rowId))
}

const asksAboutMark = (row: InboxItem): boolean =>
  row.actionable && row.resourceType === 'document' && row.anchorId !== null && !row.inertAt && isMarkAnchored(row.type)

interface MarkAnswers {
  writable: ReadonlySet<string>
  wakesOn: boolean
}

async function markAnswersFor(
  session: AuthorizedSession,
  rows: readonly InboxItem[],
  targets: Map<string, InboxTargetAccess | null>,
): Promise<MarkAnswers> {
  const documentIds = new Set(
    rows
      .filter((row) => asksAboutMark(row) && targets.get(targetKey(row.resourceType, row.resourceId)))
      .map((row) => row.resourceId),
  )
  const verdicts = await Promise.all(
    [...documentIds].map(async (documentId) => [documentId, await canWriteDocument(session, documentId).catch(() => false)] as const),
  )
  return {
    writable: new Set(verdicts.filter(([, writable]) => writable).map(([documentId]) => documentId)),
    wakesOn: isAgentWakesEnabled(session),
  }
}

function answerPlaceOf(row: InboxItem, reachable: boolean, answers: MarkAnswers): InboxAnswerPlace | null {
  if (!reachable || !asksAboutMark(row) || !answers.writable.has(row.resourceId)) return null
  return canonicalInboxType(row.type) === 'agent.asks_you' && !answers.wakesOn ? 'review' : 'row'
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function toItemView(
  row: InboxItem,
  targets: Map<string, InboxTargetAccess | null>,
  actorNames: Map<string, string>,
  withheld: ReadonlySet<string>,
  answers: MarkAnswers,
  projectNames: ReadonlyMap<string, string>,
): InboxItemView {
  const access =
    row.inertAt || withheld.has(row.id) ? null : (targets.get(targetKey(row.resourceType, row.resourceId)) ?? null)
  const payload: Record<string, unknown> = row.payload ?? {}
  const taskId = nonEmpty(payload.taskId)
  const conversationId = nonEmpty(payload.conversationId)
  const runId = nonEmpty(payload.runId)
  const messageId = nonEmpty(payload.runMessageId)
  const run: RunMessageRef | null =
    conversationId && runId && messageId ? { conversationId, runId, messageId } : null
  const answerIn = answerPlaceOf(row, access !== null, answers)

  return {
    id: row.id,
    type: canonicalInboxType(row.type) as InboxItemType,
    state: deriveState(row),
    archived: row.archivedAt !== null,
    read: row.readAt !== null,
    actionable: row.actionable,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    projectId: access?.projectId ?? null,
    projectName: access?.projectId ? (projectNames.get(access.projectId) ?? null) : null,
    anchorId: row.anchorId,
    actorName: row.actorUserId
      ? (actorNames.get(row.actorUserId) ?? (access ? coerceText(payload.actorName, SUBJECT_MAX_LENGTH) : null))
      : null,
    actorUserId: row.actorUserId,
    count: row.count,
    href: access
      ? access.deepLink({ itemType: canonicalInboxType(row.type), anchorId: row.anchorId, taskId, run })
      : null,
    subject: access ? coerceText(payload.subject, SUBJECT_MAX_LENGTH) : null,
    related: access ? coerceText(payload.related, SUBJECT_MAX_LENGTH) : null,
    excerpt: access ? coerceText(payload.excerpt, EXCERPT_MAX_LENGTH) : null,
    mentions: access ? coerceMentions(payload.mentions) : [],
    variant: access ? coerceVariant(payload.variant) : null,
    dueOn: access ? coerceDay(payload.dueOn) : null,
    openMarks: access ? coerceCount(payload.openMarks) : null,
    marksRevision: access ? coerceCount(payload.marksRevision ?? payload.marksFassung) : null,
    uploadReport: access ? parseUploadReport(payload.report) : null,
    answerIn,
    pilotiWakes: answerIn === 'row' && answers.wakesOn,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
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

async function countFiltersAcross(
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

export type { InboxMutationResult }

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
