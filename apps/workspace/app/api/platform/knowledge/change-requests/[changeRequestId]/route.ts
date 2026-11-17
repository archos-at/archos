/**
 * One change request (ADR-0165): its records' newest revisions with every claim
 * and the newest verdict on it, its approvals and its release moves.
 */

import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getPlatformChangeRequest } from '@/lib/base-knowledge/platform/service'

type Params = { changeRequestId: string }

export const GET = platformApiRoute<Params>(async ({ session, params }) => getPlatformChangeRequest(session, params.changeRequestId), {
  permission: PLATFORM_PERMISSIONS.settingsView,
})
