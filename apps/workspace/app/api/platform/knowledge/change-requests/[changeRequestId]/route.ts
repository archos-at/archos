import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getPlatformChangeRequest } from '@/lib/base-knowledge/platform/service'

type Params = { changeRequestId: string }

export const GET = platformApiRoute<Params>(async ({ session, params }) => getPlatformChangeRequest(session, params.changeRequestId), {
  permission: PLATFORM_PERMISSIONS.settingsView,
})
