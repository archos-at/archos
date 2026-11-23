import 'server-only'
import type { ProductFeedback } from '@/lib/db/schema/product-feedback'
import type { PosthogSupportConfig, SupportTicket } from '@/lib/posthog-support/types'
import type { OwnProductFeedbackSummary } from './types'

const EXCERPT_LENGTH = 140

const TICKET_SETUP_GRACE_MS = 60_000

function excerptOf(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat
}

export function hasUpdateSince(row: ProductFeedback, ticket: SupportTicket | null): boolean {
  if (!ticket) return false
  const updated = new Date(ticket.updatedAt).getTime()
  if (row.reporterSeenAt) return updated > new Date(row.reporterSeenAt).getTime()
  return updated > new Date(row.createdAt).getTime() + TICKET_SETUP_GRACE_MS
}

export function toOwnSummary(
  row: ProductFeedback,
  ticket: SupportTicket | null,
  config: PosthogSupportConfig | null,
  viewerId: string
): OwnProductFeedbackSummary {
  const mine = row.userId === viewerId
  const createdAt = new Date(row.createdAt).toISOString()
  return {
    id: row.id,
    kind: row.kind,
    excerpt: excerptOf(row.message),
    createdAt,
    status: ticket?.status ?? null,
    ticketNumber: ticket?.ticketNumber ?? null,
    lastActivityAt: ticket ? new Date(ticket.updatedAt).toISOString() : createdAt,
    hasUpdate: mine && hasUpdateSince(row, ticket),
    canReply: mine && Boolean(config && row.posthogTicketId && row.posthogWidgetSessionId),
    mine,
    reporterName: row.userName ?? null,
  }
}
