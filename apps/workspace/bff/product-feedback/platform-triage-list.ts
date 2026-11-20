import 'server-only'
import type { UserSession } from '@/lib/auth/types'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { requirePlatformPermission } from '@/lib/authz/platform'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import {
  countFeedbackTicketsByStatus,
  listFeedbackTickets,
  memberByEmail,
  type SupportTicketAssigneeFilter,
} from '@/lib/posthog-support/client'
import {
  ACTIVE_SUPPORT_TICKET_STATUSES,
  PosthogSupportUnavailableError,
  type PosthogSupportConfig,
  SUPPORT_TICKET_STATUSES,
  type SupportTicketStatus,
} from '@/lib/posthog-support/types'
import { decodeCursor, decodeOffset, encodeCursor } from './page-cursors'
import { getProductFeedbackByTicketIds, listProductFeedback, PRODUCT_FEEDBACK_LIST_LIMIT } from './repository'
import { toReportView, withOrganizationNames } from './report-views'
import { supportConfig } from './support-config'
import { ticketViews, viewerContext, type ViewerContext } from './ticket-views'
import type { ListProductFeedbackQuery, ProductFeedbackListResponse } from './types'

const UNTICKETED_WINDOW_DAYS = 30

const pageLimit = (query: ListProductFeedbackQuery): number =>
  Math.min(query.limit ?? PRODUCT_FEEDBACK_LIST_LIMIT, PRODUCT_FEEDBACK_LIST_LIMIT)

async function listLocal(
  query: ListProductFeedbackQuery,
  config: PosthogSupportConfig | null
): Promise<ProductFeedbackListResponse> {
  const rows = await listProductFeedback({
    kind: query.kind,
    before: decodeCursor(query.cursor),
    limit: pageLimit(query),
  })
  const last = rows.at(-1)
  return {
    source: 'local',
    reports: (await withOrganizationNames(rows)).map((row) => toReportView(row, null, config)),
    counts: null,
    unticketed: [],
    nextCursor: rows.length === pageLimit(query) && last ? encodeCursor(last) : null,
    viewerNotInPosthog: false,
  }
}

const zeroCounts = (): Record<SupportTicketStatus, number> =>
  Object.fromEntries(SUPPORT_TICKET_STATUSES.map((status) => [status, 0])) as Record<SupportTicketStatus, number>

function assigneeFilterOf(
  query: ListProductFeedbackQuery,
  context: ViewerContext
): SupportTicketAssigneeFilter | 'nobody' | undefined {
  if (query.assignee === 'unassigned') return 'unassigned'
  if (query.assignee !== 'mine') return undefined
  if (!context.members) throw new PosthogSupportUnavailableError('PostHog Support: members unreadable for `mine`')
  const viewer = context.viewerEmail ? memberByEmail(context.members, context.viewerEmail) : null
  return viewer ? { userId: viewer.id } : 'nobody'
}

async function listFromPosthog(
  query: ListProductFeedbackQuery,
  config: PosthogSupportConfig,
  session: UserSession | null
): Promise<ProductFeedbackListResponse> {
  const offset = decodeOffset(query.cursor)
  const context = await viewerContext(config, session)
  const assignee = assigneeFilterOf(query, context)
  if (assignee === 'nobody') {
    return { source: 'posthog', reports: [], counts: zeroCounts(), unticketed: [], nextCursor: null, viewerNotInPosthog: true }
  }
  const status = query.status === 'active' ? ACTIVE_SUPPORT_TICKET_STATUSES : query.status
  const [page, counts] = await Promise.all([
    listFeedbackTickets(config, { status, kind: query.kind, assignee, limit: pageLimit(query), offset }),
    countFeedbackTicketsByStatus(config, fetch, { assignee }),
  ])
  const since = new Date(Date.now() - UNTICKETED_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const [byTicket, unticketedRows, views] = await Promise.all([
    getProductFeedbackByTicketIds(page.tickets.map((ticket) => ticket.id)),
    offset === 0 && !assignee
      ? listProductFeedback({ kind: query.kind, unticketed: true, since, limit: PRODUCT_FEEDBACK_LIST_LIMIT })
      : Promise.resolve([]),
    ticketViews(config, page.tickets, context),
  ])
  const joined = page.tickets.flatMap((ticket) => {
    const row = byTicket.get(ticket.id)
    return row ? [{ row, ticket }] : []
  })
  const named = await withOrganizationNames([...joined.map((entry) => entry.row), ...unticketedRows])
  const nextOffset = offset + page.tickets.length
  return {
    source: 'posthog',
    reports: joined.map((entry, index) =>
      toReportView(named[index] ?? entry.row, views.get(entry.ticket.id) ?? null, config)
    ),
    counts,
    unticketed: named.slice(joined.length).map((row) => toReportView(row, null, config)),
    nextCursor:
      page.tickets.length === pageLimit(query) && nextOffset < page.count ? `o:${nextOffset}` : null,
    viewerNotInPosthog: false,
  }
}

export async function listProductFeedbackForPlatform(
  session: UserSession | null,
  query: ListProductFeedbackQuery
): Promise<ProductFeedbackListResponse> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.settingsView)
  const config = supportConfig()
  return withPlatformAccess('product feedback: triage list', async () => {
    if (!config) return listLocal(query, null)
    try {
      return await listFromPosthog(query, config, session)
    } catch (error) {
      if (!(error instanceof PosthogSupportUnavailableError)) throw error
      console.warn('[product-feedback] PostHog Support unreadable; listing the local log:', error.message)
      return listLocal({ ...query, cursor: undefined }, config)
    }
  })
}
