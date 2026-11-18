import { apiRoute } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { listPendingDeletions } from '@/lib/compliance/service'

export const GET = apiRoute(async ({ session }) => listPendingDeletions(session), {
  authz: { permission: ORG_PERMISSIONS.complianceManage },
})
