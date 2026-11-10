/**
 * One base-knowledge entry (ADR-0158).
 *
 * GET    — any member.
 * PATCH  — change a confirmed entry's values; appends a revision, never rewrites one.
 * DELETE — remove the entry and its Archiv document (the Archiv's own delete);
 *          the records go with the document. Answers a receipt per store, and
 *          `removed: true` only when nothing is left anywhere.
 *
 * Writes need org:office_shelf:manage, checked in `@/lib/base-knowledge/office/service`.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import {
  getBaseKnowledgeEntry,
  removeBaseKnowledge,
  updateBaseKnowledge,
} from '@/lib/base-knowledge/office/service'
import { updateEntryBodySchema } from '@/lib/base-knowledge/wire'
import { asProblem } from '@/lib/base-knowledge/http/problem'

type Params = { entryId: string }

export const GET = apiRoute<Params>(async ({ session, params }) => asProblem(() => getBaseKnowledgeEntry(session, params.entryId)), {
  authz: { sessionOnly: true, why: 'any member reads the Archiv; keyed by session.organizationId and filtered by the Archiv reader' },
})

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => updateBaseKnowledge(session, params.entryId, await parseJsonBody(request, updateEntryBodySchema))),
  { authz: { enforcedBy: 'updateBaseKnowledge (canManageOfficeShelf)' } }
)

export const DELETE = apiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(() => removeBaseKnowledge(session, params.entryId, request)),
  { authz: { enforcedBy: 'removeBaseKnowledge (canManageOfficeShelf)' } }
)
