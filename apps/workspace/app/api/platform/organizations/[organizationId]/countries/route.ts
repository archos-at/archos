import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { entitleOrganizationCountry } from '@/lib/base-knowledge/platform/service'
import { entitleBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { organizationId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    entitleOrganizationCountry(session, params.organizationId, await parseJsonBody(request, entitleBodySchema)),
  { permission: PLATFORM_PERMISSIONS.organizationsManage },
)
