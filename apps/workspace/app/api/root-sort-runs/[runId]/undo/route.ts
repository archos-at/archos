import { apiRoute } from '@/lib/api/handler'
import { undoRootSort } from '@/lib/filing/root-sort-run'

type Params = { runId: string }

export const POST = apiRoute<Params>(async ({ session, params }) => undoRootSort(session, params.runId), {
  authz: { enforcedBy: 'undoRootSort (the requester only; requireSortable; each move through moveDocumentToFolder)' },
})
