import { apiRoute } from '@/lib/api/handler'
import { projectShelf } from '@/lib/documents/shelf'
import { describeRootSort, startRootSort } from '@/lib/filing/root-sort-run'

type Params = { id: string }

export const GET = apiRoute<Params>(async ({ session, params }) => describeRootSort(session, projectShelf(params.id)), {
  authz: { enforcedBy: 'requireSortable (requireShelfWrite: project:documents:write | project:edit; a running project)' },
})

export const POST = apiRoute<Params>(async ({ session, params }) => startRootSort(session, projectShelf(params.id)), {
  authz: { enforcedBy: 'requireSortable (requireShelfWrite: project:documents:write | project:edit; a running project)' },
})
