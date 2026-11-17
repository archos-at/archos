import { apiRoute } from '@/lib/api/handler'
import { getInboxSummary } from '@/lib/inbox/service'

export const GET = apiRoute(
  async ({ session }) => {
    return getInboxSummary(session)
  },
  { authz: { enforcedBy: 'getInboxSummary (rows are keyed to session.userId)' } }
)
