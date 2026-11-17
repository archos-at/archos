import { NotFoundError } from '@/lib/api/errors'
import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import {
  deleteConversation,
  getConversation,
  updateConversationEngagement,
  updateConversationTitle,
} from '@/lib/conversations/service'
import { updateConversationSchema } from '@/lib/conversations/conversation-wire'
import { setConversationTemporary } from '@/lib/conversations/temporary'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => getConversation(session, params.id),
  { authz: { enforcedBy: 'getConversation (requireResourceAccess)' } }
)

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => {
    const body = await parseJsonBody(request, updateConversationSchema)
    const flagged =
      body.temporary === undefined ? null : await setConversationTemporary(session, params.id, body.temporary)
    if (flagged && !body.engagement && body.title === undefined) return flagged
    if (body.engagement) {
      return updateConversationEngagement(session, params.id, body.engagement)
    }
    return updateConversationTitle(session, params.id, body.title!)
  },
  {
    authz: {
      enforcedBy: 'updateConversationTitle / updateConversationEngagement / setConversationTemporary (requireResourceAccess)',
    },
  }
)

export const DELETE = apiRoute<Params>(
  async ({ session, params }) => {
    try {
      await deleteConversation(session, params.id)
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error
    }
    return null
  },
  { authz: { enforcedBy: 'deleteConversation (requireResourceAccess)' } }
)
