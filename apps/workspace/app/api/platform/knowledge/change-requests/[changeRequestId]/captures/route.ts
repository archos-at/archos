/**
 * Capture a page a record will cite (ADR-0170): fetched now through the
 * public-source fetcher (a configured source's hosts only, GET only), or the
 * text an operator supplies for a page that cannot be fetched, which a reviewer
 * then checks against its source. Into a draft only; KC-6 checks every quote
 * against what is captured here.
 */

import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { capturePlatformCitation } from '@/lib/base-knowledge/platform/onboarding'
import { captureBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => capturePlatformCitation(session, params.changeRequestId, await parseJsonBody(request, captureBodySchema))),
  { permission: PLATFORM_PERMISSIONS.settingsManage, status: 201 },
)
