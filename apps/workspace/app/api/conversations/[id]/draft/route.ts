import { apiRoute, parseQuery } from '@/lib/api/handler'
import { draftPreviewQuerySchema } from '@/lib/conversations/conversation-wire'
import { readConversationDraft } from '@/lib/conversations/draft-preview'
import { deleteConversationDraft } from '@/lib/conversations/draft-edits'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { path } = parseQuery(request, draftPreviewQuerySchema)
    return readConversationDraft(session, params.id, path)
  },
  { authz: { enforcedBy: 'readConversationDraft (requireResourceAccess)' } },
)

export const DELETE = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { path } = parseQuery(request, draftPreviewQuerySchema)
    return deleteConversationDraft(session, params.id, path)
  },
  { authz: { enforcedBy: 'deleteConversationDraft (requireResourceAccess collaborator on the conversation)' } },
)
