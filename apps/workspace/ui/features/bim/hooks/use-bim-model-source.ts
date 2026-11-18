'use client'

import { useCallback, useEffect, useState } from 'react'
import { getJson, IDLE, type AsyncState } from '../lib/async-request'

export function useBimModelSource(
  modelId: string | null,
  enabled: boolean
): AsyncState<string> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<string>>(IDLE)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!modelId || !enabled) {
      setState(IDLE)
      return
    }
    let cancelled = false
    setState({ data: null, isLoading: true, error: null })
    getJson<{ url: string }>(`/api/bim/models/${modelId}/source`)
      .then((body) => {
        if (!cancelled) setState({ data: body.url, isLoading: false, error: null })
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: 'load-failed' })
      })
    return () => {
      cancelled = true
    }
  }, [modelId, enabled, tick])

  return { ...state, reload: useCallback(() => setTick((value) => value + 1), []) }
}
