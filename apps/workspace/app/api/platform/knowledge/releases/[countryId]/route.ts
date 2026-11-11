import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { exportCountryRelease } from '@/lib/base-knowledge/platform/release-transfer'

type Params = { countryId: string }

export const GET = platformApiRoute<Params>(
  async ({ session, params }) => asProblem(async () => exportCountryRelease(session, params.countryId)),
  { permission: PLATFORM_PERMISSIONS.knowledgeReview },
)
