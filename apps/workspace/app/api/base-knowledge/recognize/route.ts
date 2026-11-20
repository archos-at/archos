import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import { recognizeUploads } from '@/lib/base-knowledge/office/recognition'
import { recognizeBodySchema } from '@/lib/base-knowledge/wire'

export const POST = apiRoute(
  async ({ session, request }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      return recognizeUploads(session, await parseJsonBody(request, recognizeBodySchema))
    }),
  { authz: { enforcedBy: 'recognizeUploads (canManageOfficeShelf)' } },
)
