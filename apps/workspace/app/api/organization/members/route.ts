import { apiRoute } from '@/lib/api/handler'
import { ForbiddenError } from '@/lib/api/errors'
import { isOrgAdmin } from '@/lib/authz/organizations'
import { listOrganizationMembers } from '@/lib/organizations/service'

export const GET = apiRoute(
  async ({ session }) => {
    if (!isOrgAdmin(session)) {
      throw new ForbiddenError()
    }
    return { members: await listOrganizationMembers(session.organizationId) }
  },
  { authz: { enforcedBy: 'isOrgAdmin gate in the handler' } }
)
