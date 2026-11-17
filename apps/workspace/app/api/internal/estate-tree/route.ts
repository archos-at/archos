import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { requirePinnedSession, requireVerifiedContext } from '@/lib/api/internal-envelope'
import { withTenant } from '@/lib/db/tenant-context'
import { readEstateTree } from '@/lib/estate-tree/service'
import { estateTreeRequestSchema } from '@/lib/estate-tree/types'

export const POST = internalApiRoute(
  'estate-tree',
  async ({ request }) => {
    const context = requireVerifiedContext(request)
    const body = await parseJsonBody(request, estateTreeRequestSchema)
    const session = await requirePinnedSession(context)
    return withTenant({ organizationId: context.organizationId, userId: context.userId }, () =>
      readEstateTree(context, session, body),
    )
  },
  { tenancy: { fromPayload: 'the signed request-context envelope, never the body' } },
)
