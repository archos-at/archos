import 'server-only'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { requirePlatformPermission } from '@/lib/authz/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import type { UserSession } from '@/lib/auth/types'
import { configuredAppOrigin } from '@/lib/app-origin'
import { describeResource } from '@/lib/sharing/registry'
import { getOrganizationDisplayNames } from '@/lib/organizations/display-names'
import { langfuseTraceUrl, langfuseUiConfig } from '@/lib/langfuse/config'
import { fileSlug } from '@/lib/text/latinize'
import {
  FEEDBACK_EXPORT_ROW_CAP,
  getFeedbackWeeklySummary,
  WEEKLY_APPLIED_RATINGS_FILTERS,
  weeklyWindowStart,
} from './repository'
import {
  countFeedbackVotes,
  getFeedbackExportTotals,
  getFeedbackFacets,
  getProjectNames,
  listFeedbackExportRows,
  type FeedbackExportRow,
  type FeedbackExportTotals,
  type FeedbackFacets,
} from './export-repository'
import type { FeedbackExportRecord, FeedbackWeeklyRecord } from './export-columns'
import { activeRatingsFilterKeys, ratingsFiltered, type FeedbackQuery, type RatingsFilterKey } from './filters'

export interface FeedbackExportRequest {
  query: FeedbackQuery
  withSummary: boolean
}

export interface NamedScopeEntry {
  id: string
  name: string | null
}

export interface NamedScope {
  organizations: NamedScopeEntry[]
  projects: NamedScopeEntry[]
}

export interface FeedbackExport {
  generatedAt: Date
  query: FeedbackQuery
  named: NamedScope
  records: FeedbackExportRecord[]
  truncated: boolean
  cap: number
  totals: FeedbackExportTotals | null
  weeks: FeedbackWeeklyRecord[]
  weeksTruncated: boolean
  weeksIgnored: RatingsFilterKey[]
}

function answerLink(row: FeedbackExportRow, origin: string | null): string | null {
  if (!origin || !row.conversationFound || !row.conversationId) return null
  const path = describeResource('conversation').deepLink(row.conversationId, {
    anchorId: row.messageId,
    projectId: row.projectId,
  })
  return `${origin}${path}`
}

export function weeklyIgnoredFilters(query: FeedbackQuery): RatingsFilterKey[] {
  const applied: readonly RatingsFilterKey[] = WEEKLY_APPLIED_RATINGS_FILTERS
  return activeRatingsFilterKeys(query.ratings).filter((key) => !applied.includes(key))
}

async function nameScope(query: FeedbackQuery, organizationNames: Map<string, string>): Promise<NamedScope> {
  const projectNames = await getProjectNames(query.scope.projectIds)
  return {
    organizations: query.scope.organizationIds.map((id) => ({ id, name: organizationNames.get(id) ?? null })),
    projects: query.scope.projectIds.map((id) => ({ id, name: projectNames.get(id) ?? null })),
  }
}

export async function getAnswerFeedbackExport(
  session: UserSession | null,
  request: FeedbackExportRequest,
  now: Date = new Date()
): Promise<FeedbackExport> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.organizationsView)
  const { query } = request

  const { rows, totals, weekly, projectNames } = await withPlatformAccess(
    'answer feedback export: cross-organization votes',
    async () => {
      const rows = await listFeedbackExportRows(query, FEEDBACK_EXPORT_ROW_CAP + 1)
      const projectNames = await getProjectNames(query.scope.projectIds)
      if (!request.withSummary) return { rows, totals: null, weekly: null, projectNames }
      const totals = await getFeedbackExportTotals(query)
      const weekly = await getFeedbackWeeklySummary(query)
      return { rows, totals, weekly, projectNames }
    }
  )

  const truncated = rows.length > FEEDBACK_EXPORT_ROW_CAP
  const kept = truncated ? rows.slice(0, FEEDBACK_EXPORT_ROW_CAP) : rows
  const weeks = weekly?.weeks ?? []
  const names = await getOrganizationDisplayNames([
    ...kept.map((row) => row.organizationId),
    ...weeks.map((week) => week.organizationId),
    ...query.scope.organizationIds,
  ])
  const nameOf = (organizationId: string): string | null => names.get(organizationId) ?? null
  const ui = langfuseUiConfig()
  const origin = configuredAppOrigin()

  return {
    generatedAt: now,
    query,
    named: {
      organizations: query.scope.organizationIds.map((id) => ({ id, name: nameOf(id) })),
      projects: query.scope.projectIds.map((id) => ({ id, name: projectNames.get(id) ?? null })),
    },
    records: kept.map((row) => ({
      ...row,
      organizationName: nameOf(row.organizationId),
      appUrl: answerLink(row, origin),
      langfuseTraceUrl: langfuseTraceUrl(row.traceId, ui),
    })),
    truncated,
    cap: FEEDBACK_EXPORT_ROW_CAP,
    totals,
    weeks: weeks.map((week) => ({ ...week, organizationName: nameOf(week.organizationId) })),
    weeksTruncated: weekly?.truncated ?? false,
    weeksIgnored: request.withSummary ? weeklyIgnoredFilters(query) : [],
  }
}

export interface FeedbackWeeklyExport {
  windowFrom: Date
  query: FeedbackQuery
  named: NamedScope
  weeks: FeedbackWeeklyRecord[]
  truncated: boolean
  cap: number
  ignored: RatingsFilterKey[]
}

export async function getAnswerFeedbackWeeklyExport(
  session: UserSession | null,
  query: FeedbackQuery
): Promise<FeedbackWeeklyExport> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.organizationsView)
  const { summary, organizationNames, named } = await withPlatformAccess(
    'answer feedback: weekly rate inputs across organizations',
    async () => {
      const summary = await getFeedbackWeeklySummary(query)
      const organizationNames = await getOrganizationDisplayNames([
        ...summary.weeks.map((week) => week.organizationId),
        ...query.scope.organizationIds,
      ])
      return { summary, organizationNames, named: await nameScope(query, organizationNames) }
    }
  )
  return {
    windowFrom: new Date(weeklyWindowStart(query.scope)),
    query,
    named,
    weeks: summary.weeks.map((week) => ({ ...week, organizationName: organizationNames.get(week.organizationId) ?? null })),
    truncated: summary.truncated,
    cap: summary.cap,
    ignored: weeklyIgnoredFilters(query),
  }
}

export interface FeedbackFilterOptions extends FeedbackFacets {
  total: number
  scopeTotal: number
  cap: number
  overCap: boolean
}

export async function getAnswerFeedbackFilterOptions(
  session: UserSession | null,
  query: FeedbackQuery
): Promise<FeedbackFilterOptions> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.organizationsView)
  const { counted, facets } = await withPlatformAccess(
    'answer feedback: filter options across organizations',
    async () => ({
      counted: await countFeedbackVotes(query, FEEDBACK_EXPORT_ROW_CAP),
      facets: await getFeedbackFacets(query),
    })
  )
  return {
    ...facets,
    total: Math.min(counted, FEEDBACK_EXPORT_ROW_CAP),
    scopeTotal: facets.verdicts.up + facets.verdicts.down,
    cap: FEEDBACK_EXPORT_ROW_CAP,
    overCap: counted > FEEDBACK_EXPORT_ROW_CAP,
  }
}

const FILE_STEM = 'bewertungen'

const day = (instant: Date): string => instant.toISOString().slice(0, 10)

function organizationSegment(named: NamedScope): string {
  if (named.organizations.length !== 1) return ''
  const [only] = named.organizations
  const slug = fileSlug(only.name ?? only.id, { maxLength: 40 })
  return slug ? `_${slug}` : ''
}

function narrowedBeyondName(query: FeedbackQuery): boolean {
  return (
    ratingsFiltered(query.ratings) || query.scope.projectIds.length > 0 || query.scope.organizationIds.length > 1
  )
}

export function feedbackExportFileName(
  data: Pick<FeedbackExport, 'query' | 'named' | 'truncated' | 'cap'>,
  extension: 'xlsx' | 'csv'
): string {
  const { scope } = data.query
  const filtered = narrowedBeyondName(data.query) ? '_gefiltert' : ''
  const cut = data.truncated ? `_erste-${data.cap}` : ''
  return `${FILE_STEM}${organizationSegment(data.named)}_${scope.from}_${scope.to}${filtered}${cut}.${extension}`
}

export function feedbackWeeklyFileName(
  data: Pick<FeedbackWeeklyExport, 'windowFrom' | 'query' | 'named' | 'truncated' | 'cap'>
): string {
  const cut = data.truncated ? `_erste-${data.cap}` : ''
  return `${FILE_STEM}-wochen${organizationSegment(data.named)}_${day(data.windowFrom)}_${data.query.scope.to}${cut}.csv`
}
