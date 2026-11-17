import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { similarForAgent } from '@/lib/base-knowledge/door-guard'
import { findSimilarPassages } from '@/lib/similar-passages/service'
import { similarPassagesRequestSchema } from '@/lib/similar-passages/types'

export const POST = apiRoute(
  async ({ session, request }) =>
    similarForAgent(session, await findSimilarPassages(session, await parseJsonBody(request, similarPassagesRequestSchema))),
  {
    authz: {
      enforcedBy:
        'findSimilarPassages -> getAccessibleDocument (the source), planProjectSearch (project:view and folder clearance per project), SCREENED_ONLY rows',
    },
  }
)
