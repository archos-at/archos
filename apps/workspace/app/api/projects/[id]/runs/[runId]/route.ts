import { apiRoute, parseQuery } from '@/lib/api/handler'
import { getRunView } from '@/lib/runs/service'
import { runViewQuerySchema } from '@/lib/tasks/task-wire'

type Params = { id: string; runId: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) =>
    getRunView(session, params.id, params.runId, parseQuery(request, runViewQuerySchema)),
  {
    authz: {
      enforcedBy: 'getRunView (requireProjectAccess project:view)',
    },
  },
)
