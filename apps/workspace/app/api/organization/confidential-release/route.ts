import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { confidentialReleaseEnabled, saveConfidentialRelease } from '@/lib/organizations/confidential-release'
import { confidentialReleaseSchema } from '@/lib/organizations/organization-wire'

export const GET = apiRoute(
  async ({ session }) => ({ enabled: await confidentialReleaseEnabled(session.organizationId) }),
  {
    authz: {
      sessionOnly: true,
      why: "every member reads their own organization's choice (it says whether their save dialog offers a release); keyed by session.organizationId, and the write requires org:settings:manage below",
    },
  }
)

export const PUT = apiRoute(
  async ({ session, request }) => {
    const { enabled } = await parseJsonBody(request, confidentialReleaseSchema)
    return { enabled: await saveConfidentialRelease(session, enabled, request) }
  },
  { authz: { permission: ORG_PERMISSIONS.settingsManage } }
)
