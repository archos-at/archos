'use client'

import { useCallback, useEffect, useState } from 'react'
import { getJson, IDLE, type AsyncState } from '../lib/async-request'
import type { BimQueryResponse } from '../lib/model-query-results'

export function useModelQuery<T>(
  modelId: string | null,
  request: Record<string, unknown> | null,
  select: (body: BimQueryResponse) => T | null
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>(IDLE)
  const [tick, setTick] = useState(0)
  const body = request ? JSON.stringify(request) : null

  useEffect(() => {
    if (!modelId || !body) {
      setState(IDLE)
      return
    }
    let cancelled = false
    setState({ data: null, isLoading: true, error: null })
    getJson<BimQueryResponse>(`/api/bim/models/${modelId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
      .then((payload) => {
        if (!cancelled) setState({ data: select(payload), isLoading: false, error: null })
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: 'load-failed' })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, body, tick])

  return { ...state, reload: useCallback(() => setTick((value) => value + 1), []) }
}
