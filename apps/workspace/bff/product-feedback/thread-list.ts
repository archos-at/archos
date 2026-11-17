import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { authorize, can } from '@/lib/authz/decide'
import type { ProductFeedback } from '@/lib/db/schema/product-feedback'
import { listFeedbackTicketsOf } from '@/lib/posthog-support/client'
import {
  PosthogSupportUnavailableError,
  type PosthogSupportConfig,
  type SupportTicket,
} from '@/lib/posthog-support/types'
import { decodeCursor, encodeCursor } from './page-cursors'
import { OFFICE_VIEW_PERMISSION } from './report-access'
import { OWN_PRODUCT_FEEDBACK_LIMIT, listOrganizationProductFeedback, listOwnProductFeedback } from './repository'
import { toOwnSummary } from './own-summary'
import { supportConfig } from './support-config'
import type { ListOfficeProductFeedbackQuery, ListOwnProductFeedbackQuery, OwnProductFeedbackListResponse } from './types'

const OWN_TICKETS_LIMIT = 100

async function ticketsFor(
  rows: ProductFeedback[],
  config: PosthogSupportConfig | null
): Promise<{ tickets: Map<string, SupportTicket>; live: boolean }> {
  if (!config) return { tickets: new Map(), live: false }
  const reporters = [...new Set(rows.filter((row) => row.posthogTicketId).map((row) => row.userId))]
  if (reporters.length === 0) return { tickets: new Map(), live: true }
  try {
    const found = await listFeedbackTicketsOf(config, reporters, OWN_TICKETS_LIMIT)
    return { tickets: new Map(found.map((ticket) => [ticket.id, ticket])), live: true }
  } catch (error) {
    if (!(error instanceof PosthogSupportUnavailableError)) throw error
    console.warn('[product-feedback] PostHog Support unreadable; cases without status:', error.message)
    return { tickets: new Map(), live: false }
  }
}

function caseList(
  rows: ProductFeedback[],
  limit: number,
  found: { tickets: Map<string, SupportTicket>; live: boolean },
  config: PosthogSupportConfig | null,
  session: AuthorizedSession,
  canViewOffice: boolean
): OwnProductFeedbackListResponse {
  const reports = rows.map((row) =>
    toOwnSummary(row, row.posthogTicketId ? (found.tickets.get(row.posthogTicketId) ?? null) : null, config, session.userId)
  )
  const last = rows.at(-1)
  return {
    reports,
    updatedCount: reports.filter((report) => report.hasUpdate).length,
    live: found.live,
    nextCursor: rows.length === limit && last ? encodeCursor(last) : null,
    canViewOffice,
  }
}

export async function listOwnProductFeedbackThreads(
  session: AuthorizedSession,
  query: ListOwnProductFeedbackQuery = { limit: OWN_PRODUCT_FEEDBACK_LIMIT }
): Promise<OwnProductFeedbackListResponse> {
  const limit = Math.min(query.limit, OWN_PRODUCT_FEEDBACK_LIMIT)
  const rows = await listOwnProductFeedback(session.organizationId, session.userId, {
    limit,
    before: decodeCursor(query.cursor),
  })
  const config = supportConfig()
  const [found, canViewOffice] = await Promise.all([ticketsFor(rows, config), can(session, OFFICE_VIEW_PERMISSION)])
  return caseList(rows, limit, found, config, session, canViewOffice)
}

export async function listOfficeProductFeedbackThreads(
  session: AuthorizedSession,
  query: ListOfficeProductFeedbackQuery = { limit: OWN_PRODUCT_FEEDBACK_LIMIT }
): Promise<OwnProductFeedbackListResponse> {
  await authorize(session, OFFICE_VIEW_PERMISSION)
  const limit = Math.min(query.limit, OWN_PRODUCT_FEEDBACK_LIMIT)
  const rows = await listOrganizationProductFeedback(session.organizationId, {
    limit,
    before: decodeCursor(query.cursor),
  })
  const config = supportConfig()
  return caseList(rows, limit, await ticketsFor(rows, config), config, session, true)
}
