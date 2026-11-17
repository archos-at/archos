import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { setBaseKnowledgeLicence } from '@/lib/base-knowledge/office/service'
import { licenceEntryBodySchema } from '@/lib/base-knowledge/wire'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'

type Params = { entryId: string }

export const PUT = apiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      return setBaseKnowledgeLicence(session, params.entryId, await parseJsonBody(request, licenceEntryBodySchema))
    }),
  { authz: { enforcedBy: 'setBaseKnowledgeLicence (canManageOfficeShelf)' } }
)
