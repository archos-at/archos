import { apiRoute } from '@/lib/api/handler'
import { channelKeysOf, openRealtimeStream } from '@/lib/realtime/stream'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(
  async ({ session, request }) => openRealtimeStream(session, channelKeysOf(request), request),
  { authz: { enforcedBy: 'registry channel.authorize (openRealtimeStream, per channel, re-checked while open)' } }
)
