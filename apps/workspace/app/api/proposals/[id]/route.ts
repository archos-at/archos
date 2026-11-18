import { apiRoute } from '@/lib/api/handler'
import { getProposal } from '@/lib/proposals/service'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => ({ proposal: await getProposal(session, params.id) }),
  {
    authz: {
      enforcedBy:
        'getProposal (requireProjectAccess project:view on the proposal’s project + requireResourceAccess viewer on its conversation)',
    },
  }
)
