import 'server-only'
import { randomUUID } from 'node:crypto'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { ProductFeedback } from '@/lib/db/schema/product-feedback'
import { getOrganizationDisplayName } from '@/lib/organizations/service'
import { openFeedbackTicket } from '@/lib/posthog-support/client'
import type { PosthogSupportConfig } from '@/lib/posthog-support/types'
import { maskChatText } from '@/lib/upload-screening/service'
import { announceProductFeedback } from './announce'
import { insertProductFeedback, setProductFeedbackTicket } from './repository'
import { announceToSupport } from './support-analytics'
import { supportConfig } from './support-config'
import { supportTicketText, ticketTagsFor } from './ticket-content'
import type { SubmitProductFeedbackInput, SubmittedProductFeedbackView } from './types'

async function openTicketFor(
  session: AuthorizedSession,
  report: ProductFeedback,
  input: SubmitProductFeedbackInput,
  config: PosthogSupportConfig
): Promise<void> {
  try {
    const masked = (await maskChatText(session.organizationId, input.message)).text
    const widgetSessionId = randomUUID()
    const ticketId = await openFeedbackTicket(config, {
      message: supportTicketText(report.kind, report.id, report.pagePath, masked),
      distinctId: session.userId,
      widgetSessionId,
      sessionId: input.posthog.sessionId,
      tags: ticketTagsFor(report, config),
    })
    await setProductFeedbackTicket(report.id, ticketId, widgetSessionId)
    announceToSupport('product_feedback_ticket_opened', session, report, ticketId)
  } catch (error) {
    console.error(`[product-feedback] report ${report.id} stored, but no Support ticket opened:`, error)
  }
}

export async function submitProductFeedback(
  session: AuthorizedSession,
  input: SubmitProductFeedbackInput
): Promise<SubmittedProductFeedbackView> {
  const report = await insertProductFeedback({
    organizationId: session.organizationId,
    userId: session.userId,
    userName: session.name,
    userEmail: session.email || null,
    kind: input.kind,
    message: input.message,
    pagePath: input.pagePath ?? null,
    context: input.context,
    allowContact: input.allowContact,
  })

  await announceProductFeedback(report, await getOrganizationDisplayName(session.organizationId))

  const config = supportConfig()
  if (config) await openTicketFor(session, report, input, config)

  return { id: report.id, kind: report.kind, createdAt: report.createdAt.toISOString() }
}
