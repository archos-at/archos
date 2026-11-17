import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { parseQuery } from '@/lib/api/handler'
import { listPlatformTexts } from '@/lib/base-knowledge/platform/texts'
import { listTextsQuerySchema } from '@/lib/base-knowledge/platform/text-wire'

export const GET = platformApiRoute(async ({ session, request }) => listPlatformTexts(session, parseQuery(request, listTextsQuerySchema)), {
  permission: PLATFORM_PERMISSIONS.settingsView,
})
