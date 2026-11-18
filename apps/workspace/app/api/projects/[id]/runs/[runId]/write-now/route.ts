import { apiRoute } from '@/lib/api/handler'
import { writeNowRun } from '@/lib/runs/service'

type Params = { id: string; runId: string }

export const POST = apiRoute<Params>(
  async ({ session, params }) => writeNowRun(session, params.id, params.runId),
  {
    authz: {
      enforcedBy: 'writeNowRun (requireProjectAccess project:view + CHAT_PERMISSIONS)',
    },
  }
)
