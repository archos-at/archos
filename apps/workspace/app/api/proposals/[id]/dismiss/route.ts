import { apiRoute } from '@/lib/api/handler'
import { dismissProposal } from '@/lib/proposals/service'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params }) => ({ proposal: await dismissProposal(session, params.id) }),
  {
    authz: {
      enforcedBy:
        'dismissProposal (read gate + requireProjectAccess with the kind’s right: project:documents:write, or project:memory:write for a note or a profile change; project:edit for all)',
    },
  }
)
