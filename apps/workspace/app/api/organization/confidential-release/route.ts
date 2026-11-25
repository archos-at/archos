import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import {
  confidentialReleaseForbidden,
  saveConfidentialReleaseForbidden,
} from '@/lib/organizations/confidential-release'
import { confidentialReleaseSchema } from '@/lib/organizations/organization-wire'

export const GET = apiRoute(
  async ({ session }) => ({ forbidden: await confidentialReleaseForbidden(session.organizationId) }),
  {
    authz: {
      sessionOnly: true,
      why: "every member reads their own organization's choice (it says whether their card offers a release); keyed by session.organizationId, and the write requires org:settings:manage below",
    },
  }
)

export const PUT = apiRoute(
  async ({ session, request }) => {
    const { forbidden } = await parseJsonBody(request, confidentialReleaseSchema)
    return { forbidden: await saveConfidentialReleaseForbidden(session, forbidden, request) }
  },
  { authz: { permission: ORG_PERMISSIONS.settingsManage } }
)
