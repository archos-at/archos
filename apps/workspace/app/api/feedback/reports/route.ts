import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { FEEDBACK_REPORT_LIMIT } from '@/lib/limits/catalog'
import { listOwnProductFeedbackThreads, submitProductFeedback } from '@/lib/product-feedback/service'
import { listOwnProductFeedbackQuerySchema, submitProductFeedbackSchema } from '@/lib/product-feedback/types'

export const POST = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, submitProductFeedbackSchema)
    return submitProductFeedback(session, input)
  },
  {
    authz: { enforcedBy: 'submitProductFeedback (any member; the row is keyed to session.userId)' },
    limits: { rule: FEEDBACK_REPORT_LIMIT },
    status: 201,
  }
)

export const GET = apiRoute(
  async ({ session, request }) =>
    listOwnProductFeedbackThreads(session, parseQuery(request, listOwnProductFeedbackQuerySchema)),
  {
    authz: { enforcedBy: 'listOwnProductFeedbackThreads (any member; only rows keyed to session.userId)' },
  }
)
