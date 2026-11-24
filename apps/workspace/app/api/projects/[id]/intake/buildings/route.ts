import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { applyBuildingOperation } from '@/lib/project-intake/service'
import { intakeBuildingRequestSchema, type IntakeBuildingResponse } from '@/lib/project-intake/types'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }): Promise<IntakeBuildingResponse> => {
    const { operation } = await parseJsonBody(request, intakeBuildingRequestSchema)
    return applyBuildingOperation(session, params.id, operation)
  },
  {
    authz: {
      enforcedBy:
        'applyBuildingOperation (requireProjectAccess project:memory:write or project:edit, then patchProjectProfile’s own gate)',
    },
  }
)
