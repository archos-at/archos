import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { platformKnowledgeOverview } from '@/lib/base-knowledge/platform/service'

export const GET = platformApiRoute(async ({ session }) => platformKnowledgeOverview(session), {
  permission: PLATFORM_PERMISSIONS.settingsView,
})
