import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import { onceForKey } from '@/lib/base-knowledge/http/idempotency'
import { proposeBaseKnowledge } from '@/lib/base-knowledge/office/norm-intake'
import { listBaseKnowledge } from '@/lib/base-knowledge/office/service'
import { listEntriesQuerySchema, proposeEntryBodySchema } from '@/lib/base-knowledge/wire'

export const GET = apiRoute(async ({ session, request }) => asProblem(async () => {
  requireOfficeStandardsEnabled(session)
  return listBaseKnowledge(session, parseQuery(request, listEntriesQuerySchema))
}), {
  authz: {
    sessionOnly: true,
    why: 'any member reads the Archiv, and base knowledge is a reading of Archiv documents; the read is keyed by session.organizationId and filtered by the Archiv reader',
  },
})

export const POST = apiRoute(
  async ({ session, request }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      const body = await parseJsonBody(request, proposeEntryBodySchema)
      const proposedBy = actingReaderIsAgent() ? 'agent' : 'person'
      const operation = 'base-knowledge-propose'
      const subject = body.documentId
      return onceForKey({ request, organizationId: session.organizationId, subject, operation, body }, () =>
        proposeBaseKnowledge(session, body, proposedBy),
      )
    }),
  { authz: { enforcedBy: 'proposeBaseKnowledge (canManageOfficeShelf)' }, status: 201 }
)
