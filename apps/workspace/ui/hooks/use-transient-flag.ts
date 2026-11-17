'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export const TRANSIENT_FLAG_MS = 1500

export const BUSY_REVEAL_DELAY_MS = 150

export function useTransientFlag(durationMs: number = TRANSIENT_FLAG_MS): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const timer = useRef<number | null>(null)

  const clear = useCallback((): void => {
    if (timer.current === null) return
    window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  const raise = useCallback((): void => {
    clear()
    setOn(true)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setOn(false)
    }, durationMs)
  }, [clear, durationMs])

  useEffect(() => clear, [clear])

  return [on, raise]
}

export function useDelayedFlag(active: boolean, delayMs: number = BUSY_REVEAL_DELAY_MS, minShownMs: number = 0): boolean {
  const [shown, setShown] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    if (active) {
      if (shown) return
      const timer = window.setTimeout(() => {
        shownAt.current = performance.now()
        setShown(true)
      }, delayMs)
      return () => window.clearTimeout(timer)
    }
    if (!shown) return
    const left = minShownMs - (performance.now() - shownAt.current)
    if (left <= 0) {
      setShown(false)
      return
    }
    const timer = window.setTimeout(() => setShown(false), left)
    return () => window.clearTimeout(timer)
  }, [active, shown, delayMs, minShownMs])

  return minShownMs > 0 ? shown : active && shown
}
