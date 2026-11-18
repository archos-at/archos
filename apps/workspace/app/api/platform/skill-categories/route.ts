import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { createPlatformSkillCategory, listPlatformSkillCategories } from '@/lib/skills/platform-service'
import { createCategorySchema } from '@/lib/skills/types'

export const GET = platformApiRoute(async () => listPlatformSkillCategories(), {
  permission: PLATFORM_PERMISSIONS.settingsView,
})

export const POST = platformApiRoute(
  async ({ request, session }) => {
    const input = await parseJsonBody(request, createCategorySchema)
    return createPlatformSkillCategory(input, {
      userId: session.userId,
      email: session.email ?? null,
    })
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)
