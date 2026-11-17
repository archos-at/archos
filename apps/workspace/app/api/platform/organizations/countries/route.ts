/**
 * Where every office is placed (ADR-0158, ADR-0165): each organization's home
 * country or why it has none, and the countries it is entitled to, a page at a
 * time. Read only; platform staff with `platform:organizations:view`.
 */

import { BadRequestError } from '@/lib/api/errors'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { listOrganizationPlacements } from '@/lib/base-knowledge/platform/service'
import { listOrganizationCountriesQuerySchema } from '@/lib/base-knowledge/platform/wire'

export const GET = platformApiRoute(
  async ({ session, request }) => {
    const query = listOrganizationCountriesQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!query.success) throw new BadRequestError('limit is 1 to 100; cursor is the previous page’s nextCursor')
    return listOrganizationPlacements(session, query.data)
  },
  { permission: PLATFORM_PERMISSIONS.organizationsView },
)
