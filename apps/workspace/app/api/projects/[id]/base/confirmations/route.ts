/**
 * Confirm a project's Steckbrief (ADR-0173, design §5.4): `POST { packs }` with
 * the packs the person saw in project-base-get stores the base as the server
 * resolves it now, on the person's own yes; a newer release refuses it (409).
 * Thin handler; the logic lives in `@/lib/base-knowledge/context/operations`.
 * Behind `knowledge-context`.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { FEATURE_FLAGS, requireFeature } from '@/lib/authz/feature-flags'
import { confirmProjectBase } from '@/lib/base-knowledge/context/operations'
import { projectBaseConfirmBodySchema } from '@/lib/base-knowledge/context/operations-wire'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const gated = requireFeature(session, FEATURE_FLAGS.knowledgeContext)
    if (gated) return gated
    return confirmProjectBase(session, params.id, await parseJsonBody(request, projectBaseConfirmBodySchema))
  },
  { authz: { enforcedBy: 'confirmProjectBase (requireProjectAccess project:edit, requirePersonDecision)' } },
)
