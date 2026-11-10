/** Submit a draft change request for review (ADR-0165): no more records go into it. */

import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { submitPlatformChangeRequest } from '@/lib/base-knowledge/platform/service'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(async ({ session, params }) => submitPlatformChangeRequest(session, params.changeRequestId), {
  permission: PLATFORM_PERMISSIONS.settingsManage,
})
