import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import {
  getBaseKnowledgeEntry,
  removeBaseKnowledge,
  updateBaseKnowledge,
} from '@/lib/base-knowledge/office/service'
import { updateEntryBodySchema } from '@/lib/base-knowledge/wire'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'

type Params = { entryId: string }

export const GET = apiRoute<Params>(async ({ session, params }) => asProblem(async () => {
  requireOfficeStandardsEnabled(session)
  return getBaseKnowledgeEntry(session, params.entryId)
}), {
  authz: { sessionOnly: true, why: 'any member reads the Archiv; keyed by session.organizationId and filtered by the Archiv reader' },
})

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      return updateBaseKnowledge(session, params.entryId, await parseJsonBody(request, updateEntryBodySchema))
    }),
  { authz: { enforcedBy: 'updateBaseKnowledge (canManageOfficeShelf)' } }
)

export const DELETE = apiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      return removeBaseKnowledge(session, params.entryId, request)
    }),
  { authz: { enforcedBy: 'removeBaseKnowledge (canManageOfficeShelf)' } }
)
