import { apiRoute, parseQuery } from '@/lib/api/handler'
import { listInbox } from '@/lib/inbox/service'
import { inboxListQuerySchema } from '@/lib/inbox/inbox-wire'

export const GET = apiRoute(
  async ({ session, request }) => {
    const { filter, cursor, type, projectId, limit } = parseQuery(request, inboxListQuerySchema)
    return listInbox(session, { filter: filter ?? 'all', cursor, type, projectId, limit })
  },
  { authz: { enforcedBy: 'listInbox (rows are keyed to session.userId)' } }
)
