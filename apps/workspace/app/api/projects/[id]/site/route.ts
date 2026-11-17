/**
 * Set a project's site (ADR-0172): `POST` with a register `addressId` from
 * site-resolve, or a `typed` line, writes the site through the profile's one
 * door and answers the resolution and the new profile version. Thin handler;
 * the logic lives in `@/lib/site-resolution/service`. Behind `site-resolution`.
 */

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
