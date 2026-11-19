import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import { settleProposals } from '@/lib/base-knowledge/office/settle'
import { settleProposalsBodySchema } from '@/lib/base-knowledge/wire'

export const POST = apiRoute(
  async ({ session, request }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      return settleProposals(session, await parseJsonBody(request, settleProposalsBodySchema), request)
    }),
  { authz: { enforcedBy: 'settleProposals (canManageOfficeShelf)' } },
)
