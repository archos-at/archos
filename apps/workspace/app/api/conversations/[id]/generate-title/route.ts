import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { generateTitleSchema } from '@/lib/conversations/conversation-wire'
import { generateConversationTitle } from '@/lib/conversations/service'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { messages, locale } = await parseJsonBody(request, generateTitleSchema)
    return generateConversationTitle(session, params.id, { messages, locale })
  },
  { authz: { enforcedBy: 'generateConversationTitle (requireResourceAccess)' } }
)
