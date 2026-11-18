'use client'

import { useEffect, useState } from 'react'
import { getJson, IDLE, type AsyncState } from '../lib/async-request'

export interface BimElementDetail {
  globalId: string
  expressId: number
  ifcType: string
  name: string | null
  description: string | null
  predefinedType: string | null
  objectType: string | null
  tag: string | null
  typeName: string | null
  storeyName: string | null
  materials: string[]
  classifications: Array<{ system: string | null; identification: string | null; name: string | null }>
  properties: Record<string, Record<string, string | number | boolean | null>>
  quantities: Record<string, Record<string, number>>
}

export function useBimElementDetail(
  modelId: string | null,
  globalId: string | null
): AsyncState<BimElementDetail> {
  const [state, setState] = useState<AsyncState<BimElementDetail>>(IDLE)

  useEffect(() => {
    if (!modelId || !globalId) {
      setState(IDLE)
      return
    }
    let cancelled = false
    setState({ data: null, isLoading: true, error: null })
    getJson<{ element: BimElementDetail | null }>(`/api/bim/models/${modelId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'element', globalId }),
    })
      .then((body) => {
        if (!cancelled) setState({ data: body.element, isLoading: false, error: null })
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: 'load-failed' })
      })
    return () => {
      cancelled = true
    }
  }, [modelId, globalId])

  return state
}
