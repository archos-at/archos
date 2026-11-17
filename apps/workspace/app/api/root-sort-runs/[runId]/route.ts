import { apiRoute } from '@/lib/api/handler'
import { getRootSortRun } from '@/lib/filing/root-sort-run'

type Params = { runId: string }

export const GET = apiRoute<Params>(async ({ session, params }) => getRootSortRun(session, params.runId), {
  authz: { enforcedBy: 'getRootSortRun (the requester only; requireSortable on the run’s shelf)' },
})
