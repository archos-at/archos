import { apiRoute } from '@/lib/api/handler'
import { getModelForDocument } from '@/lib/bim/model-service'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => ({ model: await getModelForDocument(session, params.id) }),
  {
    authz: {
      enforcedBy: 'getModelForDocument (ifc-models flag + the document shelf rule)',
    },
  }
)
