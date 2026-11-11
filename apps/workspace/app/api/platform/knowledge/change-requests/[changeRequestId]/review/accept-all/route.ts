/**
 * Accept every claim of a change request that has no verdict yet, in one
 * decision of the person's own (ADR-0165): the per-claim review's service and
 * rules, one audit event. A claim already decided keeps its verdict.
 */

import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { acceptAllPlatformChangeRequest } from '@/lib/base-knowledge/platform/service'
import { acceptAllBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    acceptAllPlatformChangeRequest(session, params.changeRequestId, await parseJsonBody(request, acceptAllBodySchema)),
  { permission: PLATFORM_PERMISSIONS.knowledgeReview },
)
