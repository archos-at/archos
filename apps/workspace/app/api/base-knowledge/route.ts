/**
 * The office's base knowledge (ADR-0158): its licensed standards, commentaries,
 * authority directives, guidelines and laws, each an Archiv document with its
 * edition, territory, authority, licence and last check.
 *
 * GET  — any member may read, as the Archiv is read.
 * POST — propose an entry for one Archiv document; the reading fills what the
 *        body leaves out. Needs org:office_shelf:manage, checked in the service.
 *
 * Thin handlers; the logic is `@/lib/base-knowledge/office/service`.
 */

import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { listBaseKnowledge, proposeBaseKnowledge } from '@/lib/base-knowledge/office/service'
import { listEntriesQuerySchema, proposeEntryBodySchema } from '@/lib/base-knowledge/wire'

export const GET = apiRoute(async ({ session, request }) => listBaseKnowledge(session, parseQuery(request, listEntriesQuerySchema)), {
  authz: {
    sessionOnly: true,
    why: 'any member reads the Archiv, and base knowledge is a reading of Archiv documents; the read is keyed by session.organizationId and filtered by the Archiv reader',
  },
})

export const POST = apiRoute(
  async ({ session, request }) =>
    proposeBaseKnowledge(session, await parseJsonBody(request, proposeEntryBodySchema), actingReaderIsAgent() ? 'agent' : 'person'),
  { authz: { enforcedBy: 'proposeBaseKnowledge (canManageOfficeShelf)' }, status: 201 }
)
