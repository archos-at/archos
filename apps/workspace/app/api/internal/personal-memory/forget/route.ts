import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { requirePinnedSession, requireVerifiedContext } from '@/lib/api/internal-envelope'
import { withTenant } from '@/lib/db/tenant-context'
import { forgetPersonalMemoryItem } from '@/lib/personal-memory/service'
import { internalForgetPersonalMemorySchema } from '@/lib/personal-memory/wire'

export const POST = internalApiRoute(
  'Internal Personal Memory Forget',
  async ({ request }) => {
    const context = requireVerifiedContext(request)
    const input = await parseJsonBody(request, internalForgetPersonalMemorySchema)
    await requirePinnedSession(context)
    const owner = { organizationId: context.organizationId, userId: context.userId }
    return withTenant(owner, () => forgetPersonalMemoryItem(owner, input.content))
  },
  {
    tenancy: { fromPayload: 'verified X-Request-Context envelope, never the body' },
  },
)
