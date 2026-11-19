'use client'

import { useEffect, useRef, useState } from 'react'
import type { InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'

export const SETTLE_MAX_MS = 30_000

/** Reads the open mail again, each pause longer, while a scan runs or the agent still reads. */
export function useSettlingReads({
  mailId,
  settling,
  view,
  pollMs,
  load,
  onDecidedElsewhere,
}: {
  mailId: string
  settling: boolean
  view: InboundMailView | null
  pollMs: number
  load: () => Promise<InboundMailView | null>
  onDecidedElsewhere: () => void
}): void {
  const round = useRef(0)
  const [tick, setTick] = useState(0)
  const latest = useRef({ view, load, onDecidedElsewhere })
  latest.current = { view, load, onDecidedElsewhere }
  useEffect(() => {
    round.current = 0
  }, [mailId])
  useEffect(() => {
    if (!settling) return
    let live = true
    const delay = Math.min(pollMs * 2 * 1.5 ** round.current, SETTLE_MAX_MS)
    const waitingBefore = latest.current.view?.parts.some((part) => part.state === 'waiting') ?? false
    const timer = setTimeout(() => {
      round.current += 1
      void latest.current.load().then((next) => {
        if (!live) return
        if (next && waitingBefore && !next.parts.some((part) => part.state === 'waiting')) latest.current.onDecidedElsewhere()
        setTick((value) => value + 1)
      })
    }, delay)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [settling, tick, pollMs, mailId])
}
