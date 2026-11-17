import { apiRoute } from '@/lib/api/handler'
import { listAccessibleModels } from '@/lib/bim/model-service'
import { withShelf } from '@/lib/bim/model-shelf'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => ({ models: (await listAccessibleModels(session, params.id)).map(withShelf) }),
  {
    authz: {
      enforcedBy: 'listAccessibleModels (ifc-models flag + requireProjectAccess project:view)',
    },
  }
)
