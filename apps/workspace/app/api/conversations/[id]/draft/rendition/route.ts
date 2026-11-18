import { apiRoute, parseQuery } from '@/lib/api/handler'
import { draftPreviewQuerySchema } from '@/lib/conversations/conversation-wire'
import { renderConversationDraft } from '@/lib/conversations/draft-rendition'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { path, v } = parseQuery(request, draftPreviewQuerySchema)
    return renderConversationDraft(session, params.id, path, request.headers.get('if-none-match'), v)
  },
  { authz: { enforcedBy: 'renderConversationDraft (requireResourceAccess viewer on the conversation)' } },
)
