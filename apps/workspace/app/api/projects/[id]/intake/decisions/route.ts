import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { applyIntakeDecisions } from '@/lib/project-intake/service'
import { intakeDecisionsRequestSchema, type IntakeDecisionsResponse } from '@/lib/project-intake/types'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }): Promise<IntakeDecisionsResponse> => {
    const { decisions } = await parseJsonBody(request, intakeDecisionsRequestSchema)
    return applyIntakeDecisions(session, params.id, decisions)
  },
  {
    authz: {
      enforcedBy:
        'applyIntakeDecisions (requireProjectAccess project:memory:write or project:edit, then patchProjectProfile’s own gate)',
    },
  }
)
