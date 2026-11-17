import { readHeader } from '@/lib/http/legacy-header-names'

export const ROOM_PEER_HEADER = 'x-grid-room-peer'
export const CURRENT_ROOM_PEER_HEADER = 'x-room-peer'

export function roomPeerOf(request: Request): string | null {
  const value = readHeader(request.headers, CURRENT_ROOM_PEER_HEADER)
  return value && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null
}
