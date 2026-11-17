import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { markUnreadSchema } from '@/lib/inbox/inbox-wire'
import { markUnread } from '@/lib/inbox/service'

export const POST = apiRoute(
  async ({ session, request }) => {
    const { itemIds } = await parseJsonBody(request, markUnreadSchema)
    return markUnread(session, itemIds)
  },
  { authz: { enforcedBy: 'markUnread (rows are keyed to session.userId)' } }
)
