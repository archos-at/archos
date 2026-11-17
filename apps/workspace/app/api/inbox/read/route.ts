import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { markReadSchema } from '@/lib/inbox/inbox-wire'
import { markAllRead, markAnchorItemsReadFor, markMarksSetReadFor, markRead } from '@/lib/inbox/service'

export const POST = apiRoute(
  async ({ session, request }) => {
    const body = await parseJsonBody(request, markReadSchema)
    if ('all' in body) return markAllRead(session)
    if ('anchorId' in body) return markAnchorItemsReadFor(session, body.resourceType, body.resourceId, body.anchorId)
    if ('marksSet' in body) return markMarksSetReadFor(session, body.resourceType, body.resourceId)
    return markRead(session, body.itemIds)
  },
  {
    authz: {
      enforcedBy: 'markRead / markAllRead / markAnchorItemsReadFor / markMarksSetReadFor (rows are keyed to session.userId)',
    },
  }
)
