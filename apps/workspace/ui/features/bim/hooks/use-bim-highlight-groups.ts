'use client'

import { useEffect, useState } from 'react'
import { IDLE, type AsyncState } from '../lib/async-request'
import type { BimHighlightGroup, BimHighlightStatus } from '../lib/model-index'
import { walkBimElements } from '../lib/walk-bim-elements'

export interface BimHighlightSpec {
  globalIds?: string[]
  match?: Record<string, unknown>
  label: string
  status: BimHighlightStatus
}

export function useBimHighlightGroups(
  modelId: string | null,
  specs: readonly BimHighlightSpec[]
): AsyncState<BimHighlightGroup[]> {
  const [resolved, setResolved] = useState<AsyncState<BimHighlightGroup[]>>(IDLE)
  const key = JSON.stringify(specs)

  useEffect(() => {
    const groups: BimHighlightSpec[] = JSON.parse(key)
    const literal = groups.map((group) => ({
      globalIds: group.globalIds ?? [],
      label: group.label,
      status: group.status,
    }))
    if (!modelId || !groups.some((group) => group.match)) {
      setResolved({ data: literal, isLoading: false, error: null })
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setResolved({ data: null, isLoading: true, error: null })

    const run = async (): Promise<{ next: BimHighlightGroup[]; failed: boolean }> => {
      const next: BimHighlightGroup[] = []
      let failed = false
      for (const [index, group] of groups.entries()) {
        if (!group.match) {
          next.push(literal[index])
          continue
        }
        try {
          const elements = await walkBimElements(modelId, group.match, controller.signal)
          next.push({
            globalIds: elements.map((element) => element.globalId),
            label: group.label,
            status: group.status,
          })
        } catch {
          failed = true
          next.push(literal[index])
        }
      }
      return { next, failed }
    }

    run().then(({ next, failed }) => {
      if (!cancelled) setResolved({ data: next, isLoading: false, error: failed ? 'load-failed' : null })
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [modelId, key])

  return resolved
}
