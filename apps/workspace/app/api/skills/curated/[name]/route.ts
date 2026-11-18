import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { requireSkillsEnabled } from '@/lib/authz/feature-flags'
import { setCuratedSkillEnabled } from '@/lib/skills/service'
import { curatedSkillActivationSchema } from '@/lib/skills/types'

type Params = { name: string }

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => {
    const gated = requireSkillsEnabled(session)
    if (gated) return gated
    const { enabled } = await parseJsonBody(request, curatedSkillActivationSchema)
    return setCuratedSkillEnabled(session, decodeURIComponent(params.name), enabled)
  },
  {
    authz: {
      enforcedBy: 'setCuratedSkillEnabled (org:skills:manage)',
    },
  }
)
