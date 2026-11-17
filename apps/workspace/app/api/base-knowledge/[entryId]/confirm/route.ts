import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { onceForKey } from '@/lib/base-knowledge/http/idempotency'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import { confirmBaseKnowledge } from '@/lib/base-knowledge/office/service'
import { confirmEntryBodySchema } from '@/lib/base-knowledge/wire'

type Params = { entryId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      const body = await parseJsonBody(request, confirmEntryBodySchema)
      const operation = 'base-knowledge-confirm'
      return onceForKey({ request, organizationId: session.organizationId, subject: params.entryId, operation, body }, () =>
        confirmBaseKnowledge(session, params.entryId, body),
      )
    }),
  { authz: { enforcedBy: 'confirmBaseKnowledge (canManageOfficeShelf)' } }
)
