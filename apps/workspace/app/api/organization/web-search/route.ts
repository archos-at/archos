import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { webSearchPutSchema } from '@/lib/organizations/organization-wire'
import { setOrgWebSearchEnabled } from '@/lib/organizations/service'

export const PUT = apiRoute(
  async ({ session, request }) => {
    const { enabled } = await parseJsonBody(request, webSearchPutSchema)
    const { webSearchEnabled } = await setOrgWebSearchEnabled(session, enabled, request)
    return { webSearchEnabled }
  },
  { authz: { permission: ORG_PERMISSIONS.settingsManage } }
)
