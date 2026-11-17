import { apiRoute } from '@/lib/api/handler'
import { completeIntake } from '@/lib/project-intake/service'
import type { IntakeResponse } from '@/lib/project-intake/types'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }): Promise<IntakeResponse> => ({
    intake: await completeIntake(session, params.id, request),
  }),
  {
    authz: {
      enforcedBy:
        'completeIntake (project:view, then setProjectStatus’s project:manage for a closing intent, else project:memory:write or project:edit)',
    },
  }
)
