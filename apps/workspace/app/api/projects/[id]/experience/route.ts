import { apiRoute } from '@/lib/api/handler'
import { extractProjectExperience } from '@/lib/project-experience/service'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params }) => extractProjectExperience(session, params.id),
  { authz: { enforcedBy: 'extractProjectExperience (requireProjectAccess project:memory:write or project:edit)' } }
)
