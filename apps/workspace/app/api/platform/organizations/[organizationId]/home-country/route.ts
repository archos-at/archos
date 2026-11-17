import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { setOrganizationHomeCountry } from '@/lib/base-knowledge/platform/service'
import { homeCountryBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { organizationId: string }

export const PUT = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    setOrganizationHomeCountry(session, params.organizationId, (await parseJsonBody(request, homeCountryBodySchema)).countryId),
  { permission: PLATFORM_PERMISSIONS.organizationsManage },
)
