import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { applyRootSort } from '@/lib/filing/root-sort-run'
import { applyRootSortRequestSchema } from '@/lib/filing/root-sort-wire'

type Params = { runId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { keep } = await parseJsonBody(request, applyRootSortRequestSchema)
    return applyRootSort(session, params.runId, keep)
  },
  { authz: { enforcedBy: 'applyRootSort (the requester only; requireSortable; each move through moveDocumentToFolder)' } }
)
