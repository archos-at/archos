'use client'

import { useCallback, useRef, useState } from 'react'
import type { DocumentHit, SearchResponse } from '@/lib/search/search-wire'
import type { FileItem } from '../components/project-file-workspace'

export interface SemanticHit extends FileItem {
  snippet: string
  page: number | null
  rank: number
}

interface UseSemanticSearchOptions {
  endpoint: string
  extraBody?: Record<string, unknown>
}

export interface SemanticSearchState {
  query: string | null
  active: boolean
  hits: SemanticHit[]
  isSearching: boolean
  error: boolean
  run: (query: string) => void
  reset: () => void
}

export function toSemanticHit(hit: DocumentHit, index: number): SemanticHit {
  return {
    id: hit.id,
    filename: hit.filename,
    displayName: hit.name === hit.filename ? null : hit.name,
    fileSize: null,
    contentType: hit.contentType,
    status: hit.status,
    folderId: hit.folderId,
    createdAt: hit.uploadedAt,
    errorMessage: null,
    summary: null,
    pageCount: hit.pageCount,
    chunkCount: null,
    contentTypes: null,
    tags: null,
    topics: null,
    capture: null,
    snippet: hit.passage?.text ?? '',
    page: hit.passage?.page ?? null,
    rank: index + 1,
  }
}

export function useSemanticSearch({ endpoint, extraBody }: UseSemanticSearchOptions): SemanticSearchState {
  const [query, setQuery] = useState<string | null>(null)
  const [hits, setHits] = useState<SemanticHit[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState(false)
  const requestId = useRef(0)

  const run = useCallback(
    (raw: string) => {
      const q = raw.trim()
      if (!q) return
      const id = ++requestId.current
      setQuery(q)
      setIsSearching(true)
      setError(false)

      void fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: q, ...extraBody }),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`Search failed (${r.status})`)
          return r.json() as Promise<Pick<SearchResponse, 'sections'>>
        })
        .then((data) => {
          if (requestId.current !== id) return
          setHits((data.sections?.document?.hits ?? []).map(toSemanticHit))
        })
        .catch(() => {
          if (requestId.current !== id) return
          setHits([])
          setError(true)
        })
        .finally(() => {
          if (requestId.current === id) setIsSearching(false)
        })
    },
    [endpoint, extraBody],
  )

  const reset = useCallback(() => {
    requestId.current++
    setQuery(null)
    setHits([])
    setIsSearching(false)
    setError(false)
  }, [])

  return { query, active: query !== null, hits, isSearching, error, run, reset }
}
