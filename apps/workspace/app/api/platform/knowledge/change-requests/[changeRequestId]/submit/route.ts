/**
 * Submit a draft change request for review (ADR-0165): no more records go into
 * it. Refused (422, an RFC 9457 problem with the kit's problems) unless the
 * whole request validates (ADR-0170).
 */

import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { submitPlatformChangeRequest } from '@/lib/base-knowledge/platform/service'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(async ({ session, params }) => asProblem(async () => submitPlatformChangeRequest(session, params.changeRequestId)), {
  permission: PLATFORM_PERMISSIONS.knowledgeWrite,
})
