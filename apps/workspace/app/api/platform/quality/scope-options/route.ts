import { BadRequestError } from '@/lib/api/errors'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { parseQualityScopeStrict } from '@/lib/quality/scope'
import { scopeIdsError } from '@/lib/quality/scope-ids'
import { getQualityScopeOptions } from '@/lib/quality/scope-options'

export const GET = platformApiRoute(
  async ({ request }) => {
    const parsed = parseQualityScopeStrict(new URL(request.url).searchParams)
    if (!parsed.ok) throw new BadRequestError(`Invalid scope (${parsed.error}).`, { error: parsed.error })
    const idsError = scopeIdsError(parsed.scope)
    if (idsError) throw new BadRequestError(`Invalid parameter "${idsError.param}" (${idsError.error}).`, idsError)
    return getQualityScopeOptions(parsed.scope)
  },
  { permission: PLATFORM_PERMISSIONS.organizationsView }
)
