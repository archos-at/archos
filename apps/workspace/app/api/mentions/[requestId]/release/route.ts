import { apiRoute } from '@/lib/api/handler'
import { requireCollaborationEnabled } from '@/lib/authz/feature-flags'
import { releaseRequest } from '@/lib/mentions/service'

type Params = { requestId: string }

export const POST = apiRoute<Params>(
  async ({ session, params }) => {
    const gated = requireCollaborationEnabled(session)
    if (gated) return gated
    return releaseRequest(session, params.requestId)
  },
  { authz: { enforcedBy: 'releaseRequest (requireResourceAccess)' } }
)
