import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { requireCollaborationEnabled } from '@/lib/authz/feature-flags'
import { getSharingState, setResourceVisibility } from '@/lib/sharing/service'
import { requireShareableType } from '@/lib/sharing/registry'
import { visibilitySchema } from '@/lib/sharing/sharing-wire'

type Params = { resourceType: string; resourceId: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => {
    const gated = requireCollaborationEnabled(session)
    if (gated) return gated
    return getSharingState(session, requireShareableType(params.resourceType), params.resourceId)
  },
  { authz: { enforcedBy: 'getSharingState (requireResourceAccess)' } }
)

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => {
    const gated = requireCollaborationEnabled(session)
    if (gated) return gated
    const { visibility } = await parseJsonBody(request, visibilitySchema)
    return setResourceVisibility(
      session,
      requireShareableType(params.resourceType),
      params.resourceId,
      visibility,
      request
    )
  },
  { authz: { enforcedBy: 'setResourceVisibility (requireResourceAccess owner)' } }
)
