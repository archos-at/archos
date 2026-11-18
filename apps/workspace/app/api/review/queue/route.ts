import { apiRoute, parseQuery } from '@/lib/api/handler'
import { listReviewQueueViews } from '@/lib/documents/lifecycle'
import { reviewQueueQuerySchema } from '@/lib/documents/lifecycle-types'

export const GET = apiRoute(async ({ session, request }) => listReviewQueueViews(session, parseQuery(request, reviewQueueQuerySchema)), {
  authz: {
    enforcedBy:
      'listReviewQueueViews (rows keyed to session.userId; documentVisibleTo, then requireProjectAccess project:view and folder access per row)',
  },
})
