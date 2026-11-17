/**
 * „Im Büro behandelt": the passages like one the reader is looking at, across
 * what they may read. Thin handler; who may see what is decided in
 * `@/lib/similar-passages/service`.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { similarForAgent } from '@/lib/base-knowledge/door-guard'
import { findSimilarPassages } from '@/lib/similar-passages/service'
import { similarPassagesRequestSchema } from '@/lib/similar-passages/types'

export const POST = apiRoute(
  // An agent gets a licensed copy's document and page, not its snippets (ADR-0159).
  async ({ session, request }) =>
    similarForAgent(session, await findSimilarPassages(session, await parseJsonBody(request, similarPassagesRequestSchema))),
  {
    authz: {
      enforcedBy:
        'findSimilarPassages -> getAccessibleDocument (the source), planProjectSearch (project:view and folder clearance per project), SCREENED_ONLY rows',
    },
  }
)
