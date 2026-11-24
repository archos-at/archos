'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getJson, IDLE, type AsyncState } from '../lib/async-request'
import type { BimModelHeaderView } from '../lib/model-header'

const EXTRACTION_POLL_MS = 4_000

const documentModelInFlight = new Map<string, Promise<{ model: BimModelHeaderView | null }>>()

function fetchDocumentModel(documentId: string): Promise<{ model: BimModelHeaderView | null }> {
  const existing = documentModelInFlight.get(documentId)
  if (existing) return existing
  const request = getJson<{ model: BimModelHeaderView | null }>(
    `/api/documents/${documentId}/model`
  ).finally(() => {
    documentModelInFlight.delete(documentId)
  })
  documentModelInFlight.set(documentId, request)
  return request
}

export function useDocumentBimModel(documentId: string | null): AsyncState<BimModelHeaderView | null> & {
  reload: () => void
} {
  const [state, setState] = useState<AsyncState<BimModelHeaderView | null>>(IDLE)
  const [tick, setTick] = useState(0)
  const shownFor = useRef<string | null>(null)
  const [extracting, setExtracting] = useState(false)

  useEffect(() => {
    if (!documentId) {
      shownFor.current = null
      setState(IDLE)
      setExtracting(false)
      return
    }
    let cancelled = false
    if (shownFor.current !== documentId) setExtracting(false)
    const carryOver = shownFor.current === documentId
    shownFor.current = documentId
    setState((previous) => ({
      data: carryOver ? previous.data : null,
      isLoading: true,
      error: null,
    }))
    fetchDocumentModel(documentId)
      .then((body) => {
        if (cancelled) return
        setState({ data: body.model, isLoading: false, error: null })
        setExtracting(body.model?.status === 'pending' || body.model?.status === 'extracting')
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: 'load-failed' })
      })
    return () => {
      cancelled = true
    }
  }, [documentId, tick])

  useEffect(() => {
    if (!extracting) return
    const timer = setInterval(() => setTick((value) => value + 1), EXTRACTION_POLL_MS)
    return () => clearInterval(timer)
  }, [extracting])

  return { ...state, reload: useCallback(() => setTick((value) => value + 1), []) }
}
