import { orgInstructionsSchema } from '@/lib/organizations/organization-wire'
import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import {
  getOrgInstructions,
  saveOrgInstructions,
} from '@/lib/org-instructions/service'

export const GET = apiRoute(
  async ({ session }) => ({ instructions: await getOrgInstructions(session.organizationId) }),
  {
    authz: {
      sessionOnly: true,
      why: "every member may read the instruction block that shapes their own organization's answers; the read is keyed by session.organizationId and writing requires org:settings:manage below",
    },
  },
)

export const PUT = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, orgInstructionsSchema)
    return { instructions: await saveOrgInstructions(session, input, request) }
  },
  { authz: { permission: ORG_PERMISSIONS.settingsManage } },
)
