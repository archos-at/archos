import { act } from '@testing-library/react'
import type { ChannelHandlers, RealtimeConnection } from '@/features/realtime/connection'
import { LIVE_HINT_COALESCE_MS, LIVE_HINT_JITTER_MS } from '@/features/realtime/use-live-hints'

export interface ScriptedChannels {
  connection: RealtimeConnection
  open(): string[]
  up(ch: string): void
  hint(ch: string, event: { kind: string } & Record<string, unknown>): void
}

export function scriptedChannels(advance: (ms: number) => void): ScriptedChannels {
  const joined = new Map<string, Set<ChannelHandlers>>()
  const settle = () => act(() => advance(LIVE_HINT_COALESCE_MS + LIVE_HINT_JITTER_MS))
  return {
    connection: {
      join(ch, handlers) {
        const set = joined.get(ch) ?? new Set<ChannelHandlers>()
        joined.set(ch, set.add(handlers))
        return () => {
          set.delete(handlers)
          if (set.size === 0) joined.delete(ch)
        }
      },
      send: () => undefined,
      status: () => 'connecting',
      dispose: () => joined.clear(),
    },
    open: () => [...joined.keys()],
    up(ch) {
      act(() => {
        for (const handlers of joined.get(ch) ?? []) handlers.onStatus?.('live')
      })
      settle()
    },
    hint(ch, event) {
      act(() => {
        for (const handlers of joined.get(ch) ?? []) handlers.onEvent(event)
      })
      settle()
    },
  }
}
