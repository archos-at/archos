import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { requirePersonDecision } from '@/lib/agent-api/person-decision'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { deletePlatformSkill, updatePlatformSkill } from '@/lib/skills/platform-service'
import { patchPlatformSkillSchema } from '@/lib/skills/types'

type Params = { skillId: string }

export const PATCH = platformApiRoute<Params>(
  async ({ request, params }) => {
    const patch = await parseJsonBody(request, patchPlatformSkillSchema)
    requirePersonDecision('Changing a platform skill every office is offered')
    return updatePlatformSkill(params.skillId, patch)
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)

export const DELETE = platformApiRoute<Params>(
  async ({ params }) => {
    requirePersonDecision('Deleting a platform skill from every office')
    return deletePlatformSkill(params.skillId)
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)
