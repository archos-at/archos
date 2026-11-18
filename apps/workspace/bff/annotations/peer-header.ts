import { readHeader } from '@/lib/http/legacy-header-names'
import { clientPeerIdSchema } from '@/lib/realtime/types'

export const ROOM_PEER_HEADER = 'x-room-peer'

export function roomPeerOf(request: Request): string | null {
  const value = readHeader(request.headers, ROOM_PEER_HEADER)
  return value && clientPeerIdSchema.safeParse(value).success ? value : null
}
