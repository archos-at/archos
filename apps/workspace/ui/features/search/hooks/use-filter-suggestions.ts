'use client'

import { createContext, useContext, useEffect, useState } from 'react'

import { useDebouncedValue } from '@/hooks/use-debounced-value'
import type { FacetCount, SuggestBody } from '@/lib/search/search-wire'

export type SuggestQuestion = Pick<SuggestBody, 'dimension' | 'prefix' | 'role' | 'factKey'>

export type SuggestSource = (
  question: SuggestQuestion,
  signal: AbortSignal
) => Promise<FacetCount[]>

const SuggestSourceContext = createContext<SuggestSource | null>(null)

export const SuggestSourceProvider = SuggestSourceContext.Provider

export const SUGGEST_DEBOUNCE_MS = 150

const NONE: FacetCount[] = []

export function useFilterSuggestions(
  question: Omit<SuggestQuestion, 'prefix'> | null,
  draft: string,
  focused: boolean
): FacetCount[] {
  const source = useContext(SuggestSourceContext)
  const prefix = useDebouncedValue(draft.trim(), SUGGEST_DEBOUNCE_MS)
  const [values, setValues] = useState<FacetCount[]>(NONE)
  const dimension = question?.dimension
  const role = question?.role
  const factKey = question?.factKey
  const asking = Boolean(source && dimension && focused)

  useEffect(() => {
    if (!asking || !source || !dimension) return
    const controller = new AbortController()
    source(
      { dimension, prefix, ...(role ? { role } : {}), ...(factKey ? { factKey } : {}) },
      controller.signal
    )
      .then((next) => {
        if (!controller.signal.aborted) setValues(next)
      })
      .catch(() => {
        if (!controller.signal.aborted) setValues(NONE)
      })
    return () => controller.abort()
  }, [asking, source, dimension, prefix, role, factKey])

  return asking ? values : NONE
}
