import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { deletePlatformSkillCategory, updatePlatformSkillCategory } from '@/lib/skills/platform-service'
import { patchCategorySchema } from '@/lib/skills/types'

type Params = { categoryId: string }

export const PATCH = platformApiRoute<Params>(
  async ({ request, params }) => {
    const patch = await parseJsonBody(request, patchCategorySchema)
    return updatePlatformSkillCategory(params.categoryId, patch)
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)

export const DELETE = platformApiRoute<Params>(
  async ({ params }) => deletePlatformSkillCategory(params.categoryId),
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)
