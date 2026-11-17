'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getJson } from '../lib/async-request'

export type BimRuleFactKey = 'buildingClass' | 'mainUse'

export function useProjectRuleFacts(projectId: string | null): {
  buildingClass: number | null
  mainUse: string | null
  missing: BimRuleFactKey[]
  ready: boolean
  failed: boolean
  reload: () => void
} {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  const [facts, setFacts] = useState<{ buildingClass: number | null; mainUse: string | null }>({
    buildingClass: null,
    mainUse: null,
  })

  useEffect(() => {
    if (!projectId) {
      setReady(true)
      return
    }
    setReady(false)
    setFailed(false)
    setFacts({ buildingClass: null, mainUse: null })
    let cancelled = false
    getJson<{ facts?: Record<string, { value?: unknown }> }>(`/api/projects/${projectId}/profile`)
      .then((profile) => {
        if (cancelled) return
        const raw = profile.facts ?? {}
        const klasse = Number(String(raw.building_class?.value ?? '').trim().replace(/^GK\s*/i, ''))
        const use = raw.main_use?.value
        setFacts({
          buildingClass: Number.isInteger(klasse) && klasse >= 1 && klasse <= 5 ? klasse : null,
          mainUse: typeof use === 'string' && use.trim() !== '' ? use : null,
        })
      })
      .catch(() => {
        if (!cancelled) setFacts({ buildingClass: null, mainUse: null })
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, tick])

  const missing = useMemo(() => {
    if (failed || !ready) return []
    const gaps: BimRuleFactKey[] = []
    if (facts.buildingClass === null) gaps.push('buildingClass')
    if (facts.mainUse === null) gaps.push('mainUse')
    return gaps
  }, [facts, failed, ready])

  return { ...facts, missing, ready, failed, reload: useCallback(() => setTick((v) => v + 1), []) }
}
