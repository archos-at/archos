import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { markReadSchema } from '@/lib/conversations/conversation-wire'
import { markConversationRead } from '@/lib/conversations/service'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const input = await parseJsonBody(request, markReadSchema)
    return markConversationRead(session, params.id, input)
  },
  { authz: { enforcedBy: 'markConversationRead (requireResourceAccess)' } }
)
