import { apiRoute, parseQuery } from '@/lib/api/handler'
import { findProjectsAtAddress } from '@/lib/projects/same-address'
import { sameAddressQuerySchema } from '@/lib/projects/project-wire'

export const GET = apiRoute(
  async ({ session, request }) => ({
    projects: await findProjectsAtAddress(session, parseQuery(request, sameAddressQuerySchema)),
  }),
  { authz: { enforcedBy: 'findProjectsAtAddress (per-project FGA filter, as the projects list, ADR-0038)' } }
)
