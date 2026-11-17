import { publicApiRoute, parseJsonBody } from '@/lib/api/handler'
import { enforceLimit, POSTHOG_SUPPORT_POKE_LIMIT, POSTHOG_SUPPORT_POKE_TICKET_LIMIT } from '@/lib/limits'
import { notifyFeedbackReplies } from '@/lib/product-feedback/reply-notice'
import { posthogSupportPokeSchema } from '@/lib/product-feedback/types'

export const POST = publicApiRoute(
  async ({ request }) => {
    await enforceLimit(POSTHOG_SUPPORT_POKE_LIMIT, 'deployment')
    const { ticketId } = await parseJsonBody(request, posthogSupportPokeSchema)
    await enforceLimit(POSTHOG_SUPPORT_POKE_TICKET_LIMIT, `ticket:${ticketId.toLowerCase()}`)
    await notifyFeedbackReplies(ticketId.toLowerCase())
    return null
  },
  {
    why:
      'a poke that carries only a ticket id; the thread is read back from PostHog with the server key, so a forged ' +
      'poke can only make the server re-read a real ticket (ADR-0118, second amendment). Rate limited per ticket and per deployment',
    status: 202,
  }
)
