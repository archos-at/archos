import { NextResponse } from 'next/server'
import { apiRoute } from '@/lib/api/handler'
import { requireConversationSpectator } from '@/lib/conversations/live'
import { peekNewestConversationFrame } from '@/lib/events/conversation-frames'

type Params = { id: string }

export const dynamic = 'force-dynamic'

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    await requireConversationSpectator(session, params.id)

    if (new URL(request.url).searchParams.get('peek') !== '1') {
      return NextResponse.json(
        { error: 'only ?peek=1 is served; resume a turn with attach on the socket' },
        { status: 400 }
      )
    }
    const newest = await peekNewestConversationFrame(params.id)
    return NextResponse.json(
      { available: newest !== undefined, newest: newest ?? null, now: Date.now() },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  },
  { authz: { enforcedBy: 'requireConversationSpectator (requireResourceAccess, viewer)' } }
)
