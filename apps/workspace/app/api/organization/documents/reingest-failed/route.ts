import { apiRoute } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { reingestFailedOrgDocuments } from '@/lib/documents/ingest-recovery'

export const POST = apiRoute(async ({ session }) => reingestFailedOrgDocuments(session), {
  status: 202,
  authz: { permission: ORG_PERMISSIONS.settingsManage },
})
