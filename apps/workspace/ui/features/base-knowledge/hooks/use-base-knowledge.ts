'use client'

/**
 * The state of the office standards place: which folder, which filter and
 * search, the page of entries the server answered for them, and the folders.
 * The server narrows and orders (`GET /api/base-knowledge` with `folderId`,
 * `attention`, `kind`, `q`), so hundreds of entries stay one short request per
 * page; the browser keeps only what is on screen. Only the newest answer is
 * applied, so a slow page cannot overwrite a later filter.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listBaseKnowledge,
  listBaseKnowledgeFolders,
  type BaseKnowledgeFolders,
  type BaseKnowledgeList,
  type EntryQuery,
} from '@/adapters/api/base-knowledge-client'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

export type Attention = NonNullable<EntryQuery['attention']>
export type Kind = NonNullable<EntryQuery['kind']>

export interface BaseKnowledgeFilters {
  folderId: string | null
  attention: Attention | null
  kind: Kind | null
  search: string
}

const NO_FILTERS: BaseKnowledgeFilters = { folderId: null, attention: null, kind: null, search: '' }

export interface BaseKnowledgeState {
  filters: BaseKnowledgeFilters
  setFilters: (patch: Partial<BaseKnowledgeFilters>) => void
  resetFilters: () => void
  list: BaseKnowledgeList | null
  folders: BaseKnowledgeFolders | null
  failed: boolean
  loadingMore: boolean
  loadMore: () => void
  /** Load the list and the folders again, keeping what is on screen until they arrive. */
  reload: () => Promise<void>
}

export function useBaseKnowledge(initial: Partial<BaseKnowledgeFilters> = {}): BaseKnowledgeState {
  const [filters, setFilterState] = useState<BaseKnowledgeFilters>({ ...NO_FILTERS, ...initial })
  const [list, setList] = useState<BaseKnowledgeList | null>(null)
  const [folders, setFolders] = useState<BaseKnowledgeFolders | null>(null)
  const [failed, setFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const sequence = useRef(0)
  const search = useDebouncedValue(filters.search.trim(), 250)

  const query = useCallback(
    (cursor?: string): EntryQuery => ({
      folderId: filters.folderId ?? undefined,
      attention: filters.attention ?? undefined,
      kind: filters.kind ?? undefined,
      q: search || undefined,
      cursor,
    }),
    [filters.folderId, filters.attention, filters.kind, search]
  )

  const reload = useCallback(async () => {
    const mine = ++sequence.current
    try {
      const [nextList, nextFolders] = await Promise.all([
        listBaseKnowledge(query()),
        listBaseKnowledgeFolders(),
      ])
      if (mine !== sequence.current) return
      setList(nextList)
      setFolders(nextFolders)
      setFailed(false)
    } catch {
      if (mine === sequence.current) setFailed(true)
    }
  }, [query])

  useEffect(() => {
    void reload()
  }, [reload])

  const loadMore = useCallback(() => {
    const cursor = list?.nextCursor
    if (!cursor || loadingMore) return
    const mine = sequence.current
    setLoadingMore(true)
    listBaseKnowledge(query(cursor))
      .then((page) => {
        if (mine !== sequence.current) return
        setList((current) =>
          current ? { ...page, entries: [...current.entries, ...page.entries] } : page
        )
      })
      .catch(() => setFailed(true))
      .finally(() => setLoadingMore(false))
  }, [list?.nextCursor, loadingMore, query])

  const setFilters = useCallback(
    (patch: Partial<BaseKnowledgeFilters>) =>
      setFilterState((current) => ({ ...current, ...patch })),
    []
  )
  const resetFilters = useCallback(
    () => setFilterState((current) => ({ ...NO_FILTERS, folderId: current.folderId })),
    []
  )

  return { filters, setFilters, resetFilters, list, folders, failed, loadingMore, loadMore, reload }
}
