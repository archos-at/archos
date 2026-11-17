import { apiRoute, parseQuery } from '@/lib/api/handler'
import { draftPreviewQuerySchema } from '@/lib/conversations/conversation-wire'
import { readConversationDraft } from '@/lib/conversations/draft-preview'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { path } = parseQuery(request, draftPreviewQuerySchema)
    return readConversationDraft(session, params.id, path)
  },
  { authz: { enforcedBy: 'readConversationDraft (requireResourceAccess)' } },
)
