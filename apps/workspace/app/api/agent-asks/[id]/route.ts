import { apiRoute, parseQuery } from '@/lib/api/handler'
import { getAskQuerySchema } from '@/lib/agent-asks/ask-wire'
import { getAsk } from '@/lib/agent-asks/service'

export const dynamic = 'force-dynamic'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, request, params }) => {
    const { waitSeconds } = parseQuery(request, getAskQuerySchema)
    return getAsk(session, params.id, waitSeconds ?? 0)
  },
  {
    authz: { enforcedBy: 'getAsk (the ask must be the session person’s own: requested_by = session.userId)' },
  },
)
