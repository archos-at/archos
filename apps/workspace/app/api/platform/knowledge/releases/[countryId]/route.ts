/** A country's stable release, as the gzipped JSON file another deployment imports (`platform-knowledge-release-import`). */

import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { exportCountryRelease, releaseFile } from '@/lib/base-knowledge/platform/release-transfer'

type Params = { countryId: string }

export const GET = platformApiRoute<Params>(
  async ({ session, params }) => asProblem(async () => releaseFile(await exportCountryRelease(session, params.countryId))),
  { permission: PLATFORM_PERMISSIONS.knowledgeReview },
)
