import { apiRoute, parseQuery } from '@/lib/api/handler'
import { draftPreviewQuerySchema } from '@/lib/conversations/conversation-wire'
import { restoreConversationDraft } from '@/lib/conversations/draft-edits'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { path } = parseQuery(request, draftPreviewQuerySchema)
    return restoreConversationDraft(session, params.id, path)
  },
  { authz: { enforcedBy: 'restoreConversationDraft (requireResourceAccess collaborator on the conversation)' } },
)
