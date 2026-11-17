'use client'

import { useEffect, useRef } from 'react'
import { useChannel, type ChannelLink } from './use-channel'

export const LIVE_HINT_COALESCE_MS = 400

export const LIVE_HINT_JITTER_MS = 600

export interface LiveHintOptions<E extends { kind: string }, C> {
  enabled?: boolean
  parse(event: unknown): E | null
  fold(gathered: C | null, event: E): C
  resync: C
  onChange(change: C): void
  link?: ChannelLink
  coalesceMs?: number
  jitterMs?: number
  holdWhile?: () => boolean
  holdMs?: number
}

export const LIVE_HINT_HOLD_MS = 500

export function useLiveHints<E extends { kind: string }, C>(
  key: string | null,
  {
    enabled = true,
    parse,
    fold,
    resync,
    onChange,
    link,
    coalesceMs = LIVE_HINT_COALESCE_MS,
    jitterMs = LIVE_HINT_JITTER_MS,
    holdWhile,
    holdMs = LIVE_HINT_HOLD_MS,
  }: LiveHintOptions<E, C>
): void {
  const latest = useRef({ fold, resync, onChange, coalesceMs, jitterMs, holdWhile, holdMs })
  latest.current = { fold, resync, onChange, coalesceMs, jitterMs, holdWhile, holdMs }
  const pending = useRef<{ change: C } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useRef((): void => {
    timer.current = null
    if (latest.current.holdWhile?.()) {
      timer.current = setTimeout(() => flush.current(), latest.current.holdMs)
      return
    }
    const due = pending.current
    pending.current = null
    if (due) latest.current.onChange(due.change)
  })
  const gather = useRef((change: (gathered: C | null) => C) => {
    pending.current = { change: change(pending.current?.change ?? null) }
    if (timer.current) return
    const { coalesceMs: wait, jitterMs: spread } = latest.current
    timer.current = setTimeout(() => flush.current(), wait + Math.random() * spread)
  })

  const { status, self } = useChannel<E>(key, {
    enabled,
    link,
    parse,
    onEvent: (event) => gather.current((gathered) => latest.current.fold(gathered, event)),
  })

  useEffect(() => {
    if (status === 'live') gather.current(() => latest.current.resync)
  }, [status, self])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      pending.current = null
    },
    [key]
  )
}
