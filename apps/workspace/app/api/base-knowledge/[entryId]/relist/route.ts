import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import { relistBaseKnowledge } from '@/lib/base-knowledge/office/service'
import { relistEntryBodySchema } from '@/lib/base-knowledge/wire'

type Params = { entryId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      return relistBaseKnowledge(session, params.entryId, await parseJsonBody(request, relistEntryBodySchema))
    }),
  { authz: { enforcedBy: 'relistBaseKnowledge (canManageOfficeShelf)' } },
)
