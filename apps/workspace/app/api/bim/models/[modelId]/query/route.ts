import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { BIM_QUERY_LIMIT } from '@/lib/limits'
import { bimQuerySchema } from '@/lib/bim/query'
import { queryAccessibleModel } from '@/lib/bim/model-service'

type Params = { modelId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const query = await parseJsonBody(request, bimQuerySchema)
    return queryAccessibleModel(session, params.modelId, query)
  },
  {
    limits: { rule: BIM_QUERY_LIMIT },
    authz: {
      enforcedBy:
        'queryAccessibleModel -> getAccessibleModel (ifc-models flag + requireProjectAccess project:view, or org membership for Archiv models)',
    },
  }
)
