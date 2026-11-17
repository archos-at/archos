'use client'

import { useCallback, useMemo, useState } from 'react'
import type { ShelfEndpoints } from '../lib/file-shelf'
import { useSemanticSearch, type SemanticSearchState } from './use-semantic-search'

type SearchScope = Pick<ShelfEndpoints, 'search' | 'searchBody'>

export interface FileSearch {
  query: string
  setQuery: (value: string) => void
  run: () => void
  clear: () => void
  canSearch: boolean
  semantic: SemanticSearchState
}

export function useFileSearch(scope?: SearchScope): FileSearch {
  const [query, setQueryState] = useState('')
  const endpoint = scope?.search
  const bodyKey = JSON.stringify(scope?.searchBody ?? {})
  const extraBody = useMemo(() => JSON.parse(bodyKey) as Record<string, unknown>, [bodyKey])
  const semantic = useSemanticSearch({ endpoint: endpoint ?? '', extraBody })
  const canSearch = endpoint !== undefined

  const setQuery = useCallback(
    (value: string) => {
      setQueryState(value)
      if (semantic.active) semantic.reset()
    },
    [semantic]
  )

  const run = useCallback(() => {
    if (canSearch) semantic.run(query)
  }, [canSearch, query, semantic])

  const clear = useCallback(() => {
    setQueryState('')
    semantic.reset()
  }, [semantic])

  return { query, setQuery, run, clear, canSearch, semantic }
}
