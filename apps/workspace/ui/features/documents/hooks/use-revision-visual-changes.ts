'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  parseRevisionVisualChanges,
  type CompareRegion,
  type RevisionVisualChanges,
} from '@/lib/documents/revision-compare-types'

export type RevisionVisualChangesState = 'idle' | 'loading' | 'done' | 'error'

export interface UseRevisionVisualChanges {
  state: RevisionVisualChangesState
  regions: CompareRegion[]
  summary: string[]
  errorStatus: number | null
  run: (page: number) => Promise<void>
}

const NOTHING: RevisionVisualChanges = { regions: [], summary: [] }

export function useRevisionVisualChanges(
  newerId: string | null | undefined,
  olderId: string | null | undefined,
): UseRevisionVisualChanges {
  const [state, setState] = useState<RevisionVisualChangesState>('idle')
  const [changes, setChanges] = useState<RevisionVisualChanges>(NOTHING)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const inFlight = useRef<AbortController | null>(null)
  const answered = useRef(new Map<number, RevisionVisualChanges>())

  useEffect(() => {
    const flight = inFlight
    const cache = answered.current
    return () => {
      flight.current?.abort()
      flight.current = null
      cache.clear()
      setState('idle')
      setChanges(NOTHING)
      setErrorStatus(null)
    }
  }, [newerId, olderId])

  const run = useCallback(
    async (page: number): Promise<void> => {
      if (!newerId || !olderId) return
      inFlight.current?.abort()
      const known = answered.current.get(page)
      if (known) {
        inFlight.current = null
        setChanges(known)
        setErrorStatus(null)
        setState('done')
        return
      }

      const flight = new AbortController()
      inFlight.current = flight
      setState('loading')
      setErrorStatus(null)
      try {
        const response = await fetch(`/api/documents/${encodeURIComponent(newerId)}/revision-compare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ older: olderId, page }),
          signal: flight.signal,
        })
        if (flight.signal.aborted) return
        if (!response.ok) {
          setErrorStatus(response.status)
          setState('error')
          return
        }
        const parsed = parseRevisionVisualChanges(await response.json().catch(() => null))
        if (flight.signal.aborted) return
        answered.current.set(page, parsed)
        setChanges(parsed)
        setState('done')
      } catch {
        if (flight.signal.aborted) return
        setErrorStatus(0)
        setState('error')
      }
    },
    [newerId, olderId],
  )

  return { state, regions: changes.regions, summary: changes.summary, errorStatus, run }
}
