import { apiRoute } from '@/lib/api/handler'
import { answerTrails } from '@/lib/conversations/answer-trail'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => ({ answers: await answerTrails(session, params.id) }),
  { authz: { enforcedBy: 'answerTrails (requireResourceAccess conversation viewer; names only where the reader may open them)' } }
)
