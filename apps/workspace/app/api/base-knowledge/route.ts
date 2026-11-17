/**
 * The office's base knowledge (ADR-0163): its licensed standards, commentaries,
 * authority directives, guidelines and laws, each an Archiv document with its
 * edition, territory, authority, licence and last check.
 *
 * GET  — any member may read, as the Archiv is read.
 * POST — propose an entry for one Archiv document; the reading fills what the
 *        body leaves out. Needs org:office_shelf:manage, checked in the service.
 *        Takes an `Idempotency-Key`.
 *
 * A refusal is an RFC 9457 problem (`@/lib/base-knowledge/http/problem`).
 *
 * Thin handlers; the logic is `@/lib/base-knowledge/office/service`.
 */

import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import { onceForKey } from '@/lib/base-knowledge/http/idempotency'
import { listBaseKnowledge, proposeBaseKnowledge } from '@/lib/base-knowledge/office/service'
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
