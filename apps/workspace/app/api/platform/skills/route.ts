import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { requirePersonDecision } from '@/lib/agent-api/person-decision'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { createPlatformSkill, listPlatformSkills } from '@/lib/skills/platform-service'
import { createPlatformSkillSchema } from '@/lib/skills/types'

export const GET = platformApiRoute(async () => listPlatformSkills(), {
  permission: PLATFORM_PERMISSIONS.settingsView,
})

export const POST = platformApiRoute(
  async ({ request, session }) => {
    const input = await parseJsonBody(request, createPlatformSkillSchema)
    if (input.published) requirePersonDecision('Publishing a platform skill to every office')
    return createPlatformSkill(input, {
      userId: session.userId,
      email: session.email ?? null,
    })
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)
