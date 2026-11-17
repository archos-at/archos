import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { downloadLogRetentionSchema } from '@/lib/organizations/organization-wire'
import { setDownloadLogRetentionDays } from '@/lib/download-log/service'

export const PUT = apiRoute(
  async ({ session, request }) => {
    const { days } = await parseJsonBody(request, downloadLogRetentionSchema)
    return setDownloadLogRetentionDays(session, days, request)
  },
  { authz: { permission: ORG_PERMISSIONS.settingsManage } }
)
