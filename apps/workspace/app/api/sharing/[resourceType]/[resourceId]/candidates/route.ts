import { apiRoute } from '@/lib/api/handler'
import { requireCollaborationEnabled } from '@/lib/authz/feature-flags'
import { listShareCandidates } from '@/lib/mentions/service'
import { requireShareableType } from '@/lib/sharing/registry'

type Params = { resourceType: string; resourceId: string }


export const GET = apiRoute<Params>(
  async ({ session, params }) => {
    const gated = requireCollaborationEnabled(session)
    if (gated) return gated
    return listShareCandidates(
      session,
      requireShareableType(params.resourceType),
      params.resourceId
    )
  },
  { authz: { enforcedBy: 'listShareCandidates (requireResourceAccess)' } }
)
