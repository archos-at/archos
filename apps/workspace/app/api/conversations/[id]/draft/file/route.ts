import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { fileDraftBodySchema } from '@/lib/conversations/conversation-wire'
import { fileConversationDraft } from '@/lib/conversations/draft-filing'
import { getLocale } from '@/i18n/server'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const body = await parseJsonBody(request, fileDraftBodySchema)
    return fileConversationDraft(
      session,
      params.id,
      { path: body.path, title: body.title, force: body.force, locale: await getLocale() },
      request,
    )
  },
  {
    authz: {
      enforcedBy:
        'fileConversationDraft (requireResourceAccess on the conversation, fileAgentDocumentDraft gates on the project and refuses an open destination for a thread that drew on a restricted folder)',
    },
    status: 201,
  },
)
