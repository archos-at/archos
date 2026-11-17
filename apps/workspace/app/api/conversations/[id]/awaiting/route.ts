import { apiRoute } from '@/lib/api/handler'
import { requireCollaborationEnabled } from '@/lib/authz/feature-flags'
import { getAwaitingState } from '@/lib/mentions/service'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => {
    const gated = requireCollaborationEnabled(session)
    if (gated) return gated
    return getAwaitingState(session, params.id)
  },
  { authz: { enforcedBy: 'getAwaitingState (requireResourceAccess)' } }
)
