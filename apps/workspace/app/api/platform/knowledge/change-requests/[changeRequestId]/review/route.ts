/**
 * Record a reviewer's verdicts on claims of a submitted change request
 * (ADR-0165): accepted, edited or rejected, one claim each. A verdict is no
 * approval and changes nothing offices read.
 */

import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { reviewPlatformChangeRequest } from '@/lib/base-knowledge/platform/service'
import { reviewBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    reviewPlatformChangeRequest(session, params.changeRequestId, (await parseJsonBody(request, reviewBodySchema)).decisions),
  { permission: PLATFORM_PERMISSIONS.knowledgeReview },
)
