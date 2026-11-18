import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { platformIndexStatus } from '@/lib/base-knowledge/platform/service'

type Params = { changeRequestId: string }

export const GET = platformApiRoute<Params>(async ({ session, params }) => platformIndexStatus(session, params.changeRequestId), {
  permission: PLATFORM_PERMISSIONS.settingsView,
})
