'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { attachConfirmations, type BimCheckConfirmation } from '@/lib/bim/rules'
import { getJson, type AsyncState } from '../lib/async-request'
import { selectCompliance, type BimComplianceView } from '../lib/model-query-results'
import { useModelQuery } from './use-model-query'

export function useBimCompliance(
  projectId: string | null,
  modelId: string | null,
  facts: { buildingClass: number | null; mainUse: string | null; ready?: boolean },
  seriesModelIds: readonly string[] = []
): AsyncState<BimComplianceView> & {
  confirm: (ruleId: string, note: string) => Promise<void>
  withdraw: (ruleId: string) => Promise<void>
  reload: () => void
  confirmationsFailed: boolean
} {
  const request = useMemo(
    () => ({
      op: 'compliance' as const,
      ...(facts.buildingClass === null ? {} : { buildingClass: facts.buildingClass }),
      ...(facts.mainUse === null ? {} : { mainUse: facts.mainUse }),
    }),
    [facts.buildingClass, facts.mainUse]
  )
  const run = useModelQuery(facts.ready === false ? null : modelId, request, selectCompliance)
  const [confirmations, setConfirmations] = useState<BimCheckConfirmation[]>([])
  const [confirmationsFailed, setConfirmationsFailed] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setConfirmationsFailed(false)
    getJson<{ confirmations: BimCheckConfirmation[] }>(`/api/projects/${projectId}/bim/checks`)
      .then((body) => {
        if (!cancelled) setConfirmations(body.confirmations)
      })
      .catch(() => {
        if (cancelled) return
        setConfirmations([])
        setConfirmationsFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, tick])

  const write = useCallback(
    async (method: 'POST' | 'DELETE', body: Record<string, unknown>) => {
      if (!projectId) return
      await getJson(`/api/projects/${projectId}/bim/checks`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setTick((value) => value + 1)
    },
    [projectId]
  )

  const data = useMemo(() => {
    if (!run.data || !modelId) return run.data
    return {
      ...run.data,
      rules: attachConfirmations(run.data.rules, confirmations, modelId, [
        ...seriesModelIds,
        modelId,
      ]),
    }
  }, [run.data, confirmations, modelId, seriesModelIds])

  return {
    ...run,
    data,
    confirmationsFailed,
    confirm: useCallback(
      (ruleId: string, note: string) =>
        write('POST', { ruleId, modelId, note: note === '' ? null : note }),
      [write, modelId]
    ),
    withdraw: useCallback(
      (ruleId: string) => write('DELETE', { ruleId, modelId }),
      [write, modelId]
    ),
  }
}
