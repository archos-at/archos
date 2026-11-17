'use client'

import { useEffect, useRef, useState } from 'react'
import { createRetryLadder } from '@/shared/utils/backoff'
import { parseWireEvent } from '@/adapters/api/wire-v2'
import type { TurnView } from '@/lib/turns/turn-fold'
import { foldSpectatedEvent, hasSomethingToShow } from '../lib/spectator-frames'

export interface UseSpectatedTurnOptions {
  conversationId: string | null
  enabled: boolean
  onFrame?: () => void
}

export interface UseSpectatedTurnResult {
  turn: TurnView | null
  live: boolean
}

const RECONNECT_BASE_MS = 2_000
const RECONNECT_MAX_MS = 20_000
const MAX_RECONNECTS = 4

type LiveEvent = { kind: 'frame'; payload?: unknown } | { kind: 'unsupported' } | { kind: 'revoked' }

export function useSpectatedTurn(options: UseSpectatedTurnOptions): UseSpectatedTurnResult {
  const { conversationId, enabled, onFrame } = options
  const [turn, setTurn] = useState<TurnView | null>(null)
  const [live, setLive] = useState(false)

  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  useEffect(() => {
    if (!enabled || !conversationId) {
      setTurn(null)
      setLive(false)
      return
    }

    if (typeof EventSource === 'undefined') {
      setTurn(null)
      setLive(false)
      return
    }

    let source: EventSource | null = null
    let cancelled = false
    let terminated = false
    const reconnect = createRetryLadder({
      baseMs: RECONNECT_BASE_MS,
      maxMs: RECONNECT_MAX_MS,
      budget: MAX_RECONNECTS,
    })
    setTurn(null)
    setLive(false)

    const close = (): void => {
      source?.close()
      source = null
    }

    const connect = (): void => {
      if (cancelled) return
      source = new EventSource(`/api/conversations/${encodeURIComponent(conversationId)}/live`)
      attachHandlers()
    }

    const attachHandlers = (): void => {
      if (!source) return

      source.onmessage = (event: MessageEvent<string>) => {
        if (cancelled) return
        let parsed: LiveEvent
        try {
          parsed = JSON.parse(event.data) as LiveEvent
        } catch {
          return
        }

        reconnect.reset()

        if (parsed.kind === 'unsupported' || parsed.kind === 'revoked') {
          terminated = true
          close()
          setLive(false)
          setTurn(null)
          return
        }

        if (parsed.kind !== 'frame') return
        onFrameRef.current?.()
        const wire = parseWireEvent(parsed.payload)
        if (!wire) return
        setTurn((previous) => {
          const next = foldSpectatedEvent(previous, wire)
          if (next && hasSomethingToShow(next)) setLive(true)
          return next
        })
      }

      source.onerror = () => {
        if (cancelled || terminated) return
        close()
        if (!reconnect.schedule(connect)) setLive(false)
      }
    }

    connect()

    return () => {
      cancelled = true
      reconnect.cancel()
      close()
    }
  }, [conversationId, enabled])

  return { turn, live }
}
