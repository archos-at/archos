import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { FEATURE_FLAGS, requireFeature } from '@/lib/authz/feature-flags'
import { setProjectSite } from '@/lib/site-resolution/service'
import { projectSiteSetBodySchema } from '@/lib/site-resolution/wire'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const gated = requireFeature(session, FEATURE_FLAGS.siteResolution)
    if (gated) return gated
    const body = await parseJsonBody(request, projectSiteSetBodySchema)
    return setProjectSite(session, params.id, body)
  },
  { authz: { enforcedBy: 'setProjectSite → patchProjectProfile (requireProjectAccess project:edit)' } },
)
