'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { parseSearchParams, writeSearchParams, type SearchUrlState } from '../lib/search-url'

export const SEARCH_TEXT_DEBOUNCE_MS = 300

export interface SearchUrlStateHandle {
  state: SearchUrlState
  setState: (next: SearchUrlState, options?: { history?: 'push' | 'replace' }) => void
  fieldValue: string
  setFieldValue: (value: string) => void
}

export function useSearchUrlState(): SearchUrlStateHandle {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const query = searchParams?.toString() ?? ''
  const state = useMemo(() => parseSearchParams(new URLSearchParams(query)), [query])

  const setState = useCallback(
    (next: SearchUrlState, options?: { history?: 'push' | 'replace' }) => {
      const params = writeSearchParams(next, new URLSearchParams(query)).toString()
      if (params === query) return
      const href = params ? `${pathname}?${params}` : pathname
      if (options?.history === 'replace') router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
    },
    [pathname, query, router]
  )

  const [fieldValue, setFieldValue] = useState(state.text)
  const settled = useDebouncedValue(fieldValue, SEARCH_TEXT_DEBOUNCE_MS)

  const written = useRef(state.text)
  const [seenText, setSeenText] = useState(state.text)
  if (seenText !== state.text) {
    setSeenText(state.text)
    if (state.text !== written.current) setFieldValue(state.text)
  }

  useEffect(() => {
    if (settled === state.text || settled !== fieldValue) return
    written.current = settled
    setState({ ...state, text: settled }, { history: 'replace' })
  }, [settled, fieldValue, state, setState])

  return { state, setState, fieldValue, setFieldValue }
}
