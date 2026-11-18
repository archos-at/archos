import { apiRoute } from '@/lib/api/handler'
import { requireSkillsEnabled } from '@/lib/authz/feature-flags'
import { listInvocableSkills } from '@/lib/skills/service'

export const GET = apiRoute(
  async ({ session }) => {
    const gated = requireSkillsEnabled(session)
    if (gated) return gated
    return listInvocableSkills(session)
  },
  {
    authz: {
      enforcedBy: 'listInvocableSkills (org member — invoking is use, not administration)',
    },
  }
)
