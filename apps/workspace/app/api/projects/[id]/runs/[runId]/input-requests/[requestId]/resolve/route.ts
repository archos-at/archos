/**
 * A person answers or declines a run's question (ADR-0181): an adapter over
 * `resolveInputRequest`. The body is `{ action: 'accept', content }` or
 * `{ action: 'decline' }`; the settled request comes back as the body.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { inputRequestResolveSchema } from '@/lib/runs/input-request-types'
import { resolveInputRequest } from '@/lib/runs/input-requests'

type Params = { id: string; runId: string; requestId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) =>
    resolveInputRequest(
      session,
      params.id,
      params.runId,
      params.requestId,
      await parseJsonBody(request, inputRequestResolveSchema)
    ),
  {
    authz: {
      enforcedBy:
        'resolveInputRequest (requireRunActor with write: requireProjectAccess project:view + CHAT_PERMISSIONS, refused on a closed project)',
    },
  }
)
