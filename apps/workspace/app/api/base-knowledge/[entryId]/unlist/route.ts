import { apiRoute } from '@/lib/api/handler'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import { unlistBaseKnowledge } from '@/lib/base-knowledge/office/service'

type Params = { entryId: string }

export const POST = apiRoute<Params>(
  async ({ session, params }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      return unlistBaseKnowledge(session, params.entryId)
    }),
  { authz: { enforcedBy: 'unlistBaseKnowledge (canManageOfficeShelf)' } },
)
