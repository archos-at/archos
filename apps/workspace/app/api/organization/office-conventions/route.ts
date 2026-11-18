import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { decideOfficeConvention, listOfficeConventions } from '@/lib/office-conventions/service'
import { decideConventionBodySchema } from '@/lib/office-conventions/office-conventions-wire'

export const GET = apiRoute(async ({ session }) => listOfficeConventions(session.organizationId), {
  authz: {
    sessionOnly: true,
    why: "every member's answers carry the office's conventions, so every member may read them; the read is keyed by session.organizationId and deciding requires org:settings:manage below",
  },
})

export const POST = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, decideConventionBodySchema)
    await decideOfficeConvention(session.organizationId, session.userId, input)
    return listOfficeConventions(session.organizationId)
  },
  { authz: { permission: ORG_PERMISSIONS.settingsManage } }
)
