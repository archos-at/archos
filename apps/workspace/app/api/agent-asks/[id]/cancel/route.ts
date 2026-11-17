import { apiRoute } from '@/lib/api/handler'
import { cancelAsk } from '@/lib/agent-asks/service'

export const dynamic = 'force-dynamic'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params }) => cancelAsk(session, params.id),
  {
    authz: { enforcedBy: 'cancelAsk (the ask must be the session person’s own: requested_by = session.userId)' },
  },
)
