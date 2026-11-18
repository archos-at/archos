'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShelfLive } from '@/features/realtime/use-shelf-live'
import type { LiveShelf } from '@/lib/documents/shelf-live-events'
import { getJson, IDLE, type AsyncState } from '../lib/async-request'
import type { BimModelHeaderView } from '../lib/model-header'

export const EXTRACTION_FALLBACK_POLL_MS = 60_000

const modelsInFlight = new Map<string, Promise<{ models: BimModelHeaderView[] }>>()

function fetchProjectModels(projectId: string): Promise<{ models: BimModelHeaderView[] }> {
  const existing = modelsInFlight.get(projectId)
  if (existing) return existing
  const request = getJson<{ models: BimModelHeaderView[] }>(
    `/api/projects/${projectId}/bim/models`
  ).finally(() => {
    modelsInFlight.delete(projectId)
  })
  modelsInFlight.set(projectId, request)
  return request
}

export function useProjectBimModels(projectId: string | null): AsyncState<BimModelHeaderView[]> & {
  reload: () => void
} {
  const [state, setState] = useState<AsyncState<BimModelHeaderView[]>>(IDLE)
  const [tick, setTick] = useState(0)
  const shownFor = useRef<string | null>(null)
  const [extracting, setExtracting] = useState(false)

  useEffect(() => {
    if (!projectId) {
      shownFor.current = null
      setState(IDLE)
      setExtracting(false)
      return
    }
    let cancelled = false
    if (shownFor.current !== projectId) setExtracting(false)
    const carryOver = shownFor.current === projectId
    shownFor.current = projectId
    setState((previous) => ({
      data: carryOver ? previous.data : null,
      isLoading: true,
      error: null,
    }))
    fetchProjectModels(projectId)
      .then((body) => {
        if (cancelled) return
        setState({ data: body.models, isLoading: false, error: null })
        setExtracting(
          body.models.some((model) => model.status === 'pending' || model.status === 'extracting')
        )
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: 'load-failed' })
      })
    return () => {
      cancelled = true
    }
  }, [projectId, tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const shelf = useMemo<LiveShelf | null>(() => (projectId ? { kind: 'project', projectId } : null), [projectId])
  useShelfLive(shelf, reload, { enabled: extracting })
  useEffect(() => {
    if (!extracting) return
    const timer = setInterval(reload, EXTRACTION_FALLBACK_POLL_MS)
    return () => clearInterval(timer)
  }, [extracting, reload])

  return { ...state, reload }
}
