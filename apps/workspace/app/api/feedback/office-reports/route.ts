import { apiRoute, parseQuery } from '@/lib/api/handler'
import { listOfficeProductFeedbackThreads } from '@/lib/product-feedback/service'
import { listOfficeProductFeedbackQuerySchema } from '@/lib/product-feedback/types'

export const GET = apiRoute(
  async ({ session, request }) =>
    listOfficeProductFeedbackThreads(session, parseQuery(request, listOfficeProductFeedbackQuerySchema)),
  {
    authz: { enforcedBy: 'listOfficeProductFeedbackThreads (org:settings:manage; rows of session.organizationId only)' },
  }
)
