import { apiRoute, parseQuery } from '@/lib/api/handler'
import { FEATURE_FLAGS, requireFeature } from '@/lib/authz/feature-flags'
import { resolveSite } from '@/lib/site-resolution/service'
import { siteResolveQuerySchema } from '@/lib/site-resolution/wire'

export const GET = apiRoute(
  async ({ session, request }) => {
    const gated = requireFeature(session, FEATURE_FLAGS.siteResolution)
    if (gated) return gated
    const { q } = parseQuery(request, siteResolveQuerySchema)
    return resolveSite(session, q)
  },
  {
    authz: {
      sessionOnly: true,
      why: 'a public register hosted in the cell, read for the typed text; plus the competence rulesets and authority records the organization already reads under row-level security',
    },
  },
)
