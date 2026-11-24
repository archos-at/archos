import { apiRoute, parseQuery } from '@/lib/api/handler'
import { listAnswerTrailsQuerySchema } from '@/lib/conversations/conversation-wire'
import { readableAnswerTrails } from '@/lib/conversations/reader-cut'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) =>
    readableAnswerTrails(session, params.id, parseQuery(request, listAnswerTrailsQuerySchema)),
  {
    authz: {
      enforcedBy:
        'readableAnswerTrails (requireResourceAccess conversation viewer; a reader who joined later sees the answers before the first one resting on a source they may not open)',
    },
  }
)
