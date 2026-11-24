'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { IDLE, type AsyncState } from '../lib/async-request'
import type { BimViewerElement } from '../lib/model-index'
import { walkBimElements } from '../lib/walk-bim-elements'

export function useBimElements(
  modelId: string | null
): AsyncState<BimViewerElement[]> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<BimViewerElement[]>>(IDLE)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!modelId) {
      setState(IDLE)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setState({ data: null, isLoading: true, error: null })

    walkBimElements(modelId, {}, controller.signal)
      .then((elements) => {
        if (!cancelled) setState({ data: elements, isLoading: false, error: null })
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: 'load-failed' })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [modelId, tick])

  return { ...state, reload: useCallback(() => setTick((value) => value + 1), []) }
}

export function useElementTypes(elements: readonly BimViewerElement[]): string[] {
  return useMemo(
    () => [...new Set(elements.map((element) => element.ifcType))].sort(),
    [elements]
  )
}
