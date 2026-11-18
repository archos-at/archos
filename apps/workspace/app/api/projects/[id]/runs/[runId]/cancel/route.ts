import { apiRoute } from '@/lib/api/handler'
import { cancelRun } from '@/lib/runs/service'

type Params = { id: string; runId: string }

export const POST = apiRoute<Params>(
  async ({ session, params }) => cancelRun(session, params.id, params.runId),
  {
    authz: {
      enforcedBy: 'cancelRun (requireProjectAccess project:view + CHAT_PERMISSIONS)',
    },
  },
)
