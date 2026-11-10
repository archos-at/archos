/**
 * Roll back a published change request (ADR-0165): each record returns to its
 * head before it, as appended inverse moves. The person's own yes; 409 when a
 * later release moved a record again.
 */

import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { rollbackPlatformChangeRequest } from '@/lib/base-knowledge/platform/service'
import { rollbackBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    rollbackPlatformChangeRequest(session, params.changeRequestId, (await parseJsonBody(request, rollbackBodySchema)).reason),
  { permission: PLATFORM_PERMISSIONS.settingsManage },
)
