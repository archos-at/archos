'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BimComplianceChange } from '@/lib/bim/rules'
import { getJson, IDLE, type AsyncState } from '../lib/async-request'

export function useBimComplianceDiff(
  modelId: string | null,
  baseModelId: string | null,
  facts: { buildingClass: number | null; mainUse: string | null }
): AsyncState<{ changes: BimComplianceChange[]; truncated: boolean }> & { run: () => void } {
  const [state, setState] = useState<
    AsyncState<{ changes: BimComplianceChange[]; truncated: boolean }>
  >(IDLE)

  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    setState(IDLE)
  }, [modelId, baseModelId, facts.buildingClass, facts.mainUse])

  useEffect(
    () => () => {
      generation.current += 1
    },
    []
  )

  const run = useCallback(() => {
    if (!modelId || !baseModelId) return
    generation.current += 1
    const ticket = generation.current
    setState({ data: null, isLoading: true, error: null })
    getJson<{ complianceChanges?: BimComplianceChange[]; truncated?: boolean }>(
      `/api/bim/models/${modelId}/query`,
      {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'compliance-diff',
        baseModelId,
        ...(facts.buildingClass === null ? {} : { buildingClass: facts.buildingClass }),
        ...(facts.mainUse === null ? {} : { mainUse: facts.mainUse }),
      }),
    })
      .then((body) => {
        if (generation.current !== ticket) return
        setState({
          data: { changes: body.complianceChanges ?? [], truncated: body.truncated ?? false },
          isLoading: false,
          error: null,
        })
      })
      .catch(() => {
        if (generation.current !== ticket) return
        setState({ data: null, isLoading: false, error: 'load-failed' })
      })
  }, [modelId, baseModelId, facts.buildingClass, facts.mainUse])

  return { ...state, run }
}
