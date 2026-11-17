/**
 * Platform → Skills: the fleet-wide catalogue (ADR-0016).
 *
 * Platform owners only, no per-org feature flag: this is the layer *under*
 * every tenant's skill list, not a tenant capability. A row written here is
 * OFFERED to every organization at once — it lands on each org's Skills tab for
 * it to switch on (`PATCH /api/skills/curated/{name}`).
 *
 * There is no longer a second delivery. A `standard` row ran for every tenant,
 * unlisted and unswitchable, and was forced onto each run; migration 0088
 * retired it, because an instruction that always applies is not a capability.
 * What the platform wants applied to every turn belongs in the platform prompt.
 *
 * GET  — the whole catalogue, drafts included.
 * POST — add one. Created as a DRAFT unless told otherwise, so the dashboard is
 *        usable as a writing surface rather than a publish-on-save wire. A
 *        create that publishes is the person's own decision (ADR-0170): an
 *        agent's call without their yes is refused, and a draft needs none.
 */

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
