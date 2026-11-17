import { apiRoute } from '@/lib/api/handler'
import { getStorageOverview } from '@/lib/storage/service'

export const GET = apiRoute(async ({ session }) => getStorageOverview(session), {
  authz: {
    sessionOnly: true,
    why: "every member may read their own organization's storage usage; the read is keyed by session.organizationId, and the quota is not writable from inside the tenant at all",
  },
})
