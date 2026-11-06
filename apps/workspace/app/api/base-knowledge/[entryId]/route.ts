/**
 * One base-knowledge entry (ADR-0158).
 *
 * GET    — any member.
 * PATCH  — change a confirmed entry's values; appends a revision, never rewrites one.
 * DELETE — remove the entry and its Archiv document (the Archiv's own delete);
 *          the records go with the document.
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

type Params = { entryId: string }

export const GET = apiRoute<Params>(async ({ session, params }) => getBaseKnowledgeEntry(session, params.entryId), {
  authz: { sessionOnly: true, why: 'any member reads the Archiv; keyed by session.organizationId and filtered by the Archiv reader' },
})

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => updateBaseKnowledge(session, params.entryId, await parseJsonBody(request, updateEntryBodySchema)),
  { authz: { enforcedBy: 'updateBaseKnowledge (canManageOfficeShelf)' } }
)

export const DELETE = apiRoute<Params>(
  async ({ session, params, request }) => {
    await removeBaseKnowledge(session, params.entryId, request)
    return { removed: true }
  },
  { authz: { enforcedBy: 'removeBaseKnowledge (canManageOfficeShelf)' } }
)
