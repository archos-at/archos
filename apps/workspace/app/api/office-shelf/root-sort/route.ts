import { apiRoute } from '@/lib/api/handler'
import { OFFICE_SHELF } from '@/lib/documents/shelf'
import { describeRootSort, startRootSort } from '@/lib/filing/root-sort-run'

export const GET = apiRoute(async ({ session }) => describeRootSort(session, OFFICE_SHELF), {
  authz: { enforcedBy: 'requireSortable (requireShelfWrite: canManageOfficeShelf)' },
})

export const POST = apiRoute(async ({ session }) => startRootSort(session, OFFICE_SHELF), {
  authz: { enforcedBy: 'requireSortable (requireShelfWrite: canManageOfficeShelf)' },
})
