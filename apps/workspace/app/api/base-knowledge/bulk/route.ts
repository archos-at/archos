import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import { bulkBaseKnowledge } from '@/lib/base-knowledge/office/bulk'
import { bulkEntriesBodySchema } from '@/lib/base-knowledge/wire'

export const POST = apiRoute(
  async ({ session, request }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      return bulkBaseKnowledge(session, await parseJsonBody(request, bulkEntriesBodySchema), request)
    }),
  { authz: { enforcedBy: 'bulkBaseKnowledge (canManageOfficeShelf)' } },
)
