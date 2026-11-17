import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { requireSkillsEnabled } from '@/lib/authz/feature-flags'
import { reviewSkill } from '@/lib/skills/review'
import { reviewSkillSchema } from '@/lib/skills/types'

export const POST = apiRoute(
  async ({ session, request }) => {
    const gated = requireSkillsEnabled(session)
    if (gated) return gated
    const input = await parseJsonBody(request, reviewSkillSchema)
    return reviewSkill(session, input)
  },
  {
    authz: {
      enforcedBy: 'reviewSkill (org member — reviewing a draft is not a privileged action)',
    },
  }
)
