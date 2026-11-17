import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  FINISH_MAX_MS,
  advancePace,
  finishCut,
  finishDuration,
  furthestCleanCut,
  initialPace,
  keepThroughRewrite,
  noteArrival,
  type PaceState,
} from '../lib/stream-pace'

const PACING_BY_DEFAULT = process.env.NODE_ENV !== 'test'

export const SETTLE_GRACE_MS = 1000

export interface PacedText {
  text: string
  settled: boolean
  idle: boolean
}

export const IDLE_AFTER_MS = 600

const pageHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden'

export const ARRIVED_AT_MOUNT_CHARS = 400

const onScreen = new Set<string>()

function startingLength(text: string, id: string | undefined, leadChars: number): number {
  const joinedMidway = (id !== undefined && onScreen.has(id)) || text.length - leadChars > ARRIVED_AT_MOUNT_CHARS
  return joinedMidway ? furthestCleanCut(text, 0, text.length) : 0
}

const prependedLead = (previous: string, text: string): number =>
  previous && text.length > previous.length && !text.startsWith(previous) && text.endsWith(previous)
    ? text.length - previous.length
    : 0

export function usePacedText(
  text: string,
  streaming: boolean,
  enabled = PACING_BY_DEFAULT,
  stopped = false,
  id?: string,
  leadChars = 0
): PacedText {
  const paced = enabled && streaming
  const [start] = useState(() => (paced ? startingLength(text, id, leadChars) : text.length))
  const [shown, setShown] = useState(start)
  const [settled, setSettled] = useState(!paced)
  const pace = useRef<PaceState>(initialPace(start))
  const shownRef = useRef(shown)
  const lastText = useRef(text)
  const latest = useRef(text)
  const [frozen, setFrozen] = useState<string | null>(null)

  const show = (length: number) => {
    if (length === shownRef.current) return
    shownRef.current = length
    setShown(length)
  }

  useEffect(() => {
    latest.current = text
  })

  useLayoutEffect(() => {
    if (!streaming) return
    const previous = lastText.current
    lastText.current = text
    let next = pace.current
    const lead = prependedLead(previous, text)
    if (lead > 0 && next.shown > 0) {
      next = { ...next, shown: next.shown + lead, arrivals: next.arrivals.map((length) => length + lead) }
    } else if (!text.startsWith(previous.slice(0, shownRef.current))) {
      next = initialPace(keepThroughRewrite(text, shownRef.current))
    }
    next = noteArrival(next, text.length, performance.now())
    pace.current = next
    show(next.shown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, streaming])

  useLayoutEffect(() => {
    if (!streaming) return
    if (enabled) setSettled(false)
  }, [streaming, enabled])

  useEffect(() => {
    if (!id || !enabled) return
    if (settled) onScreen.delete(id)
    else onScreen.add(id)
  }, [id, enabled, settled])

  const behind = enabled && streaming && shown < text.length
  useEffect(() => {
    if (!behind) return
    let last = performance.now()
    let id = requestAnimationFrame(function step(now) {
      const next = advancePace(pace.current, latest.current, Math.max(0, now - last), now)
      last = now
      pace.current = next
      show(next.shown)
      id = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [behind])

  const [idleAt, setIdleAt] = useState(-1)
  useEffect(() => {
    if (!enabled || settled) return
    const timer = window.setTimeout(() => setIdleAt(shown), IDLE_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [shown, settled, enabled])

  useLayoutEffect(() => {
    if (streaming || settled) return
    if (stopped) {
      setFrozen(text.slice(0, shownRef.current))
      setSettled(true)
      return
    }
    const settle = () => {
      lastText.current = latest.current
      pace.current = initialPace(latest.current.length)
      show(latest.current.length)
      setSettled(true)
    }
    const from = shownRef.current
    const continues = text.startsWith(lastText.current.slice(0, from))
    if (!enabled || !continues || from >= text.length || pageHidden()) {
      settle()
      return
    }
    lastText.current = text
    const duration = finishDuration(text.length - from)
    const start = performance.now()
    let id = requestAnimationFrame(function step(now) {
      const elapsed = now - start
      const cut = finishCut(latest.current, from, shownRef.current, elapsed, duration)
      if (cut >= latest.current.length) {
        settle()
        return
      }
      show(cut)
      id = requestAnimationFrame(step)
    })
    const onHidden = () => {
      if (pageHidden()) settle()
    }
    document.addEventListener('visibilitychange', onHidden)
    const timer = window.setTimeout(settle, duration + SETTLE_GRACE_MS)
    return () => {
      cancelAnimationFrame(id)
      document.removeEventListener('visibilitychange', onHidden)
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, settled, enabled, stopped])

  if (frozen !== null) return { text: frozen, settled: true, idle: false }
  if (!enabled) return { text, settled: !streaming, idle: false }
  if (settled) return { text, settled, idle: false }
  return { text: text.slice(0, Math.min(shown, text.length)), settled, idle: idleAt === shown }
}

export const MAX_SETTLE_MS = FINISH_MAX_MS + SETTLE_GRACE_MS
