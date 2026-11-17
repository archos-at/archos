import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { detachMailThreadEntry } from '@/lib/mail-thread/detach'
import { mailThreadEntryDetachBodySchema } from '@/lib/mail-thread/mail-thread-wire'

type Params = { id: string; threadId: string; entryId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const body = await parseJsonBody(request, mailThreadEntryDetachBodySchema)
    return detachMailThreadEntry(session, params.id, params.threadId, params.entryId, body, request)
  },
  {
    authz: {
      enforcedBy:
        'detachMailThreadEntry -> requireMailReviewer (inbound-mail entitlement; project:documents:write any-of project:edit) + requireFolderWrite on both thread documents’ folders',
    },
  }
)
