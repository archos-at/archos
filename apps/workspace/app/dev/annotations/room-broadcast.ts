import type { RoomEvent } from '@/lib/annotations/room-types'
import type { RealtimeFrame } from '@/lib/realtime/types'
import { FILE } from './fixtures'

export const CHANNEL = `doc:${FILE.id}`
export type Listener = (frame: RealtimeFrame) => void
export const sources = new Set<Listener>()
export const broadcast = (event: RoomEvent) => sources.forEach((listener) => listener({ kind: 'event', ch: CHANNEL, event }))
