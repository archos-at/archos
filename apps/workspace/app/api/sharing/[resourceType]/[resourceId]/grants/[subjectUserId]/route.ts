import { apiRoute } from '@/lib/api/handler'
import { requireCollaborationEnabled } from '@/lib/authz/feature-flags'
import { revokeResourceAccess } from '@/lib/sharing/service'
import { requireShareableType } from '@/lib/sharing/registry'

type Params = { resourceType: string; resourceId: string; subjectUserId: string }


export const DELETE = apiRoute<Params>(
  async ({ session, params, request }) => {
    const gated = requireCollaborationEnabled(session)
    if (gated) return gated
    return revokeResourceAccess(
      session,
      requireShareableType(params.resourceType),
      params.resourceId,
      params.subjectUserId,
      request
    )
  },
  { authz: { enforcedBy: 'revokeResourceAccess (requireResourceAccess owner)' } }
)
