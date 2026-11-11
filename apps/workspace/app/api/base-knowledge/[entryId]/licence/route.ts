/**
 * A confirmed base-knowledge copy's licence (ADR-0163): its class and the
 * office's statements on it. Whether the copy's text reaches a model turns on
 * these, so they change here and nowhere else, and only on the person's own
 * call (the operation is `personDecides` and offered to no agent of the office).
 *
 * PUT — needs org:office_shelf:manage, checked in `@/lib/base-knowledge/office/service`.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { setBaseKnowledgeLicence } from '@/lib/base-knowledge/office/service'
import { licenceEntryBodySchema } from '@/lib/base-knowledge/wire'
import { asProblem } from '@/lib/base-knowledge/http/problem'

type Params = { entryId: string }

export const PUT = apiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => setBaseKnowledgeLicence(session, params.entryId, await parseJsonBody(request, licenceEntryBodySchema))),
  { authz: { enforcedBy: 'setBaseKnowledgeLicence (canManageOfficeShelf)' } }
)
