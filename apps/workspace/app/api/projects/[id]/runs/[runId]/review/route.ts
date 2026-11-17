import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { requireSkillsEnabled } from '@/lib/authz/feature-flags'
import { reviewTask, toTaskRunViews } from '@/lib/tasks/service'
import { reviewTaskSchema } from '@/lib/tasks/types'

type Params = { id: string; runId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const gated = requireSkillsEnabled(session)
    if (gated) return gated
    const input = await parseJsonBody(request, reviewTaskSchema)
    const reviewed = await reviewTask(session, params.id, params.runId, input, request)
    const [run] = await toTaskRunViews(session.organizationId, [reviewed])
    return { run }
  },
  {
    authz: {
      enforcedBy: 'reviewTask (requireProjectAccess project:edit)',
    },
  }
)
