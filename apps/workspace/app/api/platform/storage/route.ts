import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getPlatformStorageOverview } from '@/lib/storage/platform-service'

export const GET = platformApiRoute(async () => getPlatformStorageOverview(), {
  permission: PLATFORM_PERMISSIONS.organizationsView,
})
