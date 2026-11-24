import { NextResponse } from 'next/server'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { requirePinnedSession, requireVerifiedContext } from '@/lib/api/internal-envelope'
import { withTenant } from '@/lib/db/tenant-context'
import { decideTurn } from '@/lib/conversation-context/turn-decision'
import { turnDecisionRequestSchema } from '@/lib/conversation-context/wire'
import { TurnContextTiming } from '@/lib/turn-context/timing'

export const POST = internalApiRoute(
  'Internal Turn Decision',
  async ({ request }) => {
    const context = requireVerifiedContext(request)
    const input = await parseJsonBody(request, turnDecisionRequestSchema)
    const timing = new TurnContextTiming()
    const session = await timing.time('session', () => requirePinnedSession(context))
    const data = await timing.time('decide', () =>
      withTenant({ organizationId: context.organizationId, userId: context.userId }, () =>
        decideTurn(session, context, input.answerMessageId ?? null),
      ),
    )
    return NextResponse.json(data, { headers: { 'Server-Timing': timing.header() } })
  },
  {
    tenancy: { fromPayload: 'verified request-context envelope, never the body' },
  },
)
