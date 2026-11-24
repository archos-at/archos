import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { requirePinnedSession, requireVerifiedContext } from '@/lib/api/internal-envelope'
import { withTenant } from '@/lib/db/tenant-context'
import { decideTurn } from '@/lib/conversation-context/turn-decision'
import { turnDecisionRequestSchema } from '@/lib/conversation-context/wire'

export const POST = internalApiRoute(
  'Internal Turn Decision',
  async ({ request }) => {
    const context = requireVerifiedContext(request)
    const input = await parseJsonBody(request, turnDecisionRequestSchema)
    const session = await requirePinnedSession(context)
    return withTenant({ organizationId: context.organizationId, userId: context.userId }, () =>
      decideTurn(session, context, input.answerMessageId ?? null),
    )
  },
  {
    tenancy: { fromPayload: 'verified request-context envelope, never the body' },
  },
)
