import { apiRoute, parseQuery } from '@/lib/api/handler'
import { unreadAnchorsQuerySchema } from '@/lib/inbox/inbox-wire'
import { unreadAnchorsFor } from '@/lib/inbox/service'

export const GET = apiRoute(
  async ({ session, request }) => {
    const { resourceType, resourceId } = parseQuery(request, unreadAnchorsQuerySchema)
    return unreadAnchorsFor(session, resourceType, resourceId)
  },
  { authz: { enforcedBy: 'unreadAnchorsFor (rows are keyed to session.userId)' } }
)
