import { apiRoute, parseQuery } from '@/lib/api/handler'
import { listOpenProposals } from '@/lib/proposals/service'
import { proposalListQuerySchema, type ProposalListResponse } from '@/lib/proposals/types'

export const GET = apiRoute(
  async ({ session, request }): Promise<ProposalListResponse> =>
    listOpenProposals(session, parseQuery(request, proposalListQuerySchema)),
  {
    authz: {
      enforcedBy:
        'listOpenProposals (requireProjectAccess project:view on a project shelf; per row: viewer on its conversation, or every document it names resolvable for the reader)',
    },
  }
)
