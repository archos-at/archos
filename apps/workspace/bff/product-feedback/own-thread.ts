import 'server-only'
import { ConflictError, UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { ProductFeedback } from '@/lib/db/schema/product-feedback'
import { getSupportTicket, listCustomerVisibleMessages, replyAsCustomer } from '@/lib/posthog-support/client'
import {
  PosthogSupportUnavailableError,
  type PosthogSupportConfig,
  type SupportMessage,
  type SupportTicket,
} from '@/lib/posthog-support/types'
import { maskChatText } from '@/lib/upload-screening/service'
import { ownReport, readableReport } from './report-access'
import { markOwnProductFeedbackSeen } from './repository'
import { toOwnSummary } from './own-summary'
import { announceToSupport } from './support-analytics'
import { supportConfig } from './support-config'
import type { OwnProductFeedbackMessage, OwnProductFeedbackThread } from './types'

function threadMessages(row: ProductFeedback, ticketMessages: SupportMessage[]): OwnProductFeedbackMessage[] {
  const header = `[${row.kind}] #${row.id}`
  const first: OwnProductFeedbackMessage = {
    id: row.id,
    author: 'reporter',
    authorName: null,
    content: row.message,
    createdAt: new Date(row.createdAt).toISOString(),
  }
  const rest = ticketMessages
    .filter((message) => !(message.author === 'customer' && message.content.startsWith(header)))
    .map((message) => ({
      id: message.id,
      author: message.author === 'customer' ? ('reporter' as const) : ('team' as const),
      authorName: message.authorName,
      content: message.content,
      createdAt: message.createdAt,
    }))
  return [first, ...rest]
}

async function liveThread(
  row: ProductFeedback,
  config: PosthogSupportConfig | null
): Promise<{ ticket: SupportTicket; messages: SupportMessage[] } | null> {
  if (!config || !row.posthogTicketId) return null
  try {
    const [ticket, messages] = await Promise.all([
      getSupportTicket(config, row.posthogTicketId),
      listCustomerVisibleMessages(config, row.posthogTicketId),
    ])
    return ticket ? { ticket, messages } : null
  } catch (error) {
    if (!(error instanceof PosthogSupportUnavailableError)) throw error
    console.warn(`[product-feedback] thread of report ${row.id} unreadable:`, error.message)
    return null
  }
}

export async function getOwnProductFeedbackThread(
  session: AuthorizedSession,
  id: string
): Promise<OwnProductFeedbackThread> {
  const row = await readableReport(session, id)
  const mine = row.userId === session.userId
  const config = supportConfig()
  const live = await liveThread(row, config)
  const seenAt = new Date()
  if (live && mine) await markOwnProductFeedbackSeen(session.organizationId, session.userId, row.id, seenAt)
  const seen = live && mine ? { ...row, reporterSeenAt: seenAt } : row
  return {
    report: toOwnSummary(seen, live?.ticket ?? null, config, session.userId),
    messages: threadMessages(row, live?.messages ?? []),
    live: live !== null,
  }
}

export async function replyToOwnProductFeedback(
  session: AuthorizedSession,
  id: string,
  message: string
): Promise<OwnProductFeedbackThread> {
  const row = await ownReport(session, id)
  const config = supportConfig()
  if (!config || !row.posthogTicketId || !row.posthogWidgetSessionId) {
    throw new ConflictError('This report cannot be answered here.')
  }
  let masked: string
  try {
    masked = (await maskChatText(session.organizationId, message)).text
  } catch (error) {
    console.error(`[product-feedback] reply on report ${row.id} not sent: the policy could not mask it`, error)
    throw new UpstreamError('Your reply could not be sent.')
  }
  try {
    await replyAsCustomer(config, {
      ticketId: row.posthogTicketId,
      widgetSessionId: row.posthogWidgetSessionId,
      distinctId: session.userId,
      message: masked,
    })
  } catch (error) {
    if (error instanceof PosthogSupportUnavailableError) throw new UpstreamError('Your reply could not be sent.')
    throw error
  }
  announceToSupport('product_feedback_reply_sent', session, row, row.posthogTicketId)
  return getOwnProductFeedbackThread(session, id)
}
