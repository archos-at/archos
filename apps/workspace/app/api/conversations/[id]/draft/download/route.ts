import { apiRoute, parseQuery } from '@/lib/api/handler'
import { draftPreviewQuerySchema } from '@/lib/conversations/conversation-wire'
import { downloadConversationDraft } from '@/lib/conversations/draft-file'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { path } = parseQuery(request, draftPreviewQuerySchema)
    return downloadConversationDraft(session, params.id, path)
  },
  { authz: { enforcedBy: 'downloadConversationDraft (requireResourceAccess viewer on the conversation)' } },
)
