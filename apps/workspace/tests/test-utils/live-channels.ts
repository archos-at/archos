/**
 * The tab's live connection, scripted: for a spec of a surface that re-reads
 * on a channel's hint (`useLiveHints`, `useShelfLive`). It stands where
 * `getRealtimeConnection` does, so the spec also proves which channel the
 * surface opened: a hint on another project's key reaches nobody.
 *
 *   const live = vi.hoisted(() => ({ current: null as ScriptedChannels | null }))
 *   vi.mock('@/features/realtime/connection', async (original) => ({
 *     ...(await original<typeof import('@/features/realtime/connection')>()),
 *     getRealtimeConnection: () => live.current!.connection,
 *   }))
 */

import { act } from '@testing-library/react'
import type { ChannelHandlers, RealtimeConnection } from '@/features/realtime/connection'
import { LIVE_HINT_COALESCE_MS, LIVE_HINT_JITTER_MS } from '@/features/realtime/use-live-hints'

export interface ScriptedChannels {
  connection: RealtimeConnection
  /** The channel keys open right now. */
  open(): string[]
  /** The channel comes up, as after the server's welcome. Needs fake timers: waits out the hint coalescing. */
  up(ch: string): void
  /** A hint arrives on a channel, and its burst is waited out. Needs fake timers. */
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
