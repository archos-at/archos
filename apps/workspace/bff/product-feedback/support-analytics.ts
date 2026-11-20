import 'server-only'
import { captureServer } from '@/lib/analytics/posthog-server'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { ProductFeedback } from '@/lib/db/schema/product-feedback'

export function announceToSupport(
  event: 'product_feedback_ticket_opened' | 'product_feedback_reply_sent',
  session: AuthorizedSession,
  report: ProductFeedback,
  ticketId: string
): void {
  captureServer({
    event,
    distinctId: session.userId,
    organizationId: session.organizationId,
    properties: {
      ticket_id: ticketId,
      report_id: report.id,
      kind: report.kind,
      allow_contact: report.allowContact,
    },
  })
}
