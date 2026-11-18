import { NextResponse } from 'next/server'
import { tenantSlotRoute } from '@/lib/db/tenant-context'
import { getUserSession } from '@/lib/auth/session'
import { resolveTurnContext, TurnBudgetExhaustedError } from '@/lib/turns/turn-context'
import { isAuthzRefusal } from '@/lib/api/errors'
import { isAuthRequired } from '@/lib/backend-proxy'

export const GET = tenantSlotRoute(async function GET(req: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId') || undefined
    const conversationId = searchParams.get('conversationId') || undefined

    const session = await getUserSession()

    if (isAuthRequired() && !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json(await resolveTurnContext(session, { projectId, conversationId }), { status: 200 })
  } catch (error) {
    if (error instanceof TurnBudgetExhaustedError) {
      return NextResponse.json({ error: 'Budget exhausted', reason: error.message }, { status: 403 })
    }
    if (isAuthzRefusal(error)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('[WebSocket Scope API] Error:', error)

    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
})
