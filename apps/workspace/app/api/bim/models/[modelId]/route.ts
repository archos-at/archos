import { apiRoute } from '@/lib/api/handler'
import { getAccessibleModel } from '@/lib/bim/model-service'

type Params = { modelId: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => getAccessibleModel(session, params.modelId),
  {
    authz: {
      enforcedBy:
        'getAccessibleModel (ifc-models flag + requireProjectAccess project:view, or org membership for Archiv models)',
    },
  }
)
