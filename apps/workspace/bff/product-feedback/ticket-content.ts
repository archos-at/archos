import 'server-only'
import type { ProductFeedback } from '@/lib/db/schema/product-feedback'
import {
  FEEDBACK_TICKET_TAG,
  kindTicketTag,
  NO_CONTACT_TICKET_TAG,
  originTicketTag,
  type PosthogSupportConfig,
} from '@/lib/posthog-support/types'
import type { ProductFeedbackKind } from './types'

export function supportTicketText(
  kind: ProductFeedbackKind,
  reportId: string,
  pagePath: string | null,
  maskedText: string
): string {
  return `[${kind}] #${reportId}${pagePath ? ` ${pagePath}` : ''}\n${maskedText}`
}

export function ticketTagsFor(
  report: Pick<ProductFeedback, 'kind' | 'allowContact'>,
  config: Pick<PosthogSupportConfig, 'appOrigin'>
): string[] {
  const origin = originTicketTag(config.appOrigin)
  return [
    FEEDBACK_TICKET_TAG,
    kindTicketTag(report.kind),
    ...(report.allowContact ? [] : [NO_CONTACT_TICKET_TAG]),
    ...(origin ? [origin] : []),
  ]
}
