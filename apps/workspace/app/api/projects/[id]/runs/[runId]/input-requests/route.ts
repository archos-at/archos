/**
 * What a run has asked a person (ADR-0181): an adapter over
 * `listInputRequests`. One keyset page, newest first, open and settled alike.
 */

import { apiRoute, parseQuery } from '@/lib/api/handler'
import { inputRequestListQuerySchema } from '@/lib/runs/input-request-types'
import { listInputRequests } from '@/lib/runs/input-requests'

type Params = { id: string; runId: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) =>
    listInputRequests(session, params.id, params.runId, parseQuery(request, inputRequestListQuerySchema)),
  {
    authz: {
      enforcedBy: 'listInputRequests (requireRunActor: requireProjectAccess project:view + CHAT_PERMISSIONS)',
    },
  }
)
