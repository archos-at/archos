import { z } from 'zod'
import { NotFoundError } from '@/lib/api/errors'
import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { FEEDBACK_REPLY_LIMIT } from '@/lib/limits/catalog'
import { getOwnProductFeedbackThread, replyToOwnProductFeedback } from '@/lib/product-feedback/service'
import { replyToProductFeedbackSchema } from '@/lib/product-feedback/types'

type Params = { reportId?: string | string[] }

function parseReportId(params: Params): string {
  const parsed = z.guid().safeParse(params.reportId)
  if (!parsed.success) throw new NotFoundError('Unknown feedback report.')
  return parsed.data
}

export const GET = apiRoute<Params>(
  async ({ session, params }) => getOwnProductFeedbackThread(session, parseReportId(params)),
  {
    authz: { enforcedBy: 'getOwnProductFeedbackThread (the reporter only; rows keyed to session.userId)' },
  }
)

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { message } = await parseJsonBody(request, replyToProductFeedbackSchema)
    return replyToOwnProductFeedback(session, parseReportId(params), message)
  },
  {
    authz: { enforcedBy: 'replyToOwnProductFeedback (the reporter only; rows keyed to session.userId)' },
    limits: { rule: FEEDBACK_REPLY_LIMIT },
    status: 201,
  }
)
