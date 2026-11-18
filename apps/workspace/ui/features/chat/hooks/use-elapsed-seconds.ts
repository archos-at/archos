'use client'

import { useEffect, useState } from 'react'

export type ElapsedSince = Date | string | number

const startOf = (since: ElapsedSince | undefined): number | null => {
  if (since === undefined) return null
  const ms = since instanceof Date ? since.getTime() : new Date(since).getTime()
  return Number.isFinite(ms) ? ms : null
}

const secondsSince = (start: number): number =>
  Math.max(0, Math.floor((Date.now() - start) / 1000))

export const useElapsedSeconds = (active: boolean, since?: ElapsedSince): number => {
  const sinceMs = startOf(since)
  const [seconds, setSeconds] = useState(() =>
    active && sinceMs !== null ? secondsSince(sinceMs) : 0
  )

  useEffect(() => {
    if (!active) return
    const start = sinceMs ?? Date.now()
    setSeconds(secondsSince(start))
    const id = setInterval(() => setSeconds(secondsSince(start)), 1000)
    return () => clearInterval(id)
  }, [active, sinceMs])

  return seconds
}

export const formatElapsed = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
