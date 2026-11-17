import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { followMailThread, unfollowMailThread } from '@/lib/mail-thread/follows'
import { mailThreadFollowBodySchema, mailThreadUnfollowQuerySchema } from '@/lib/mail-thread/mail-thread-wire'

type Params = { id: string; threadId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const body = (await request.clone().text()).trim() ? await parseJsonBody(request, mailThreadFollowBodySchema) : {}
    return followMailThread(session, params.id, params.threadId, body)
  },
  {
    authz: {
      enforcedBy:
        'followMailThread -> requireMailReviewer (inbound-mail entitlement; project:documents:write any-of project:edit) + the thread readable + requireFolderWrite on its document’s folder (an open project)',
    },
  },
)

export const DELETE = apiRoute<Params>(
  async ({ session, params, request }) =>
    unfollowMailThread(session, params.id, params.threadId, parseQuery(request, mailThreadUnfollowQuerySchema)),
  {
    authz: {
      enforcedBy:
        'unfollowMailThread (inbound-mail entitlement; project:view; another person’s follow only with project:manage)',
    },
  },
)
