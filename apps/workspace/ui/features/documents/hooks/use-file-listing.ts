'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toFileItem, type DocumentWireRow } from '../lib/file-item'
import { fetchListingPages, type ListingPage } from '../lib/fetch-listing-pages'
import type { FileItem } from '../file-types'
import type { ShelfEndpoints } from '../lib/file-shelf'
import { useSettlingRefresh } from './use-settling-refresh'
import { useSettlingStatusReads } from './use-settling-status-reads'

interface ListingBody extends ListingPage<DocumentWireRow> {
  collectionName?: string
}

export interface FileListingOptions {
  endpoints: Pick<ShelfEndpoints, 'list' | 'listParams'>
  agentAuthoredOnly: boolean
  includeArchived: boolean
  initialFiles?: readonly DocumentWireRow[]
  initialNextCursor?: string | null
  enabled?: boolean
}

const NO_FILES: readonly FileItem[] = []

type Commit = 'per-page' | 'at-end'

function appendPage(previous: FileItem[], page: FileItem[]): FileItem[] {
  if (page.length === 0) return previous
  const held = new Set(previous.map((file) => file.id))
  const fresh = page.filter((file) => !held.has(file.id))
  return fresh.length === 0 ? previous : [...previous, ...fresh]
}

export function useFileListing({
  endpoints,
  agentAuthoredOnly,
  includeArchived,
  initialFiles,
  initialNextCursor = null,
  enabled = true,
}: FileListingOptions) {
  const seededWith = initialFiles !== undefined
  const [files, setFiles] = useState<FileItem[]>(() => (initialFiles ?? []).map(toFileItem))
  const [isLoading, setIsLoading] = useState(!seededWith && enabled)
  const [complete, setComplete] = useState(seededWith && initialNextCursor === null)
  const [error, setError] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [collectionName, setCollectionName] = useState<string | undefined>(undefined)
  const loadGeneration = useRef(0)

  const settlingReads = useSettlingStatusReads(files, setFiles)
  const { beginLoad } = settlingReads
  useSettlingRefresh(enabled ? files : NO_FILES, settlingReads.tick)

  const { list, listParams } = endpoints
  const paramsKey = JSON.stringify(listParams ?? {})
  const url = listingUrl(list, paramsKey, agentAuthoredOnly, includeArchived)
  const shownUrl = useRef<string | null>(seededWith ? url : null)

  const drain = useCallback(
    ({ quiet, from }: { quiet: boolean; from?: { cursor: string } }): Promise<void> => {
      if (!enabled) return Promise.resolve()
      const generation = ++loadGeneration.current
      const withNewerReads = beginLoad()
      const isStale = () => generation !== loadGeneration.current
      const commit: Commit = from || shownUrl.current !== url ? 'per-page' : 'at-end'
      const showsSkeleton = !quiet && commit === 'per-page' && !from
      if (showsSkeleton) setIsLoading(true)
      if (commit === 'per-page') setComplete(false)
      setError(false)
      return fetchListingPages<DocumentWireRow, ListingBody>(url, {
        from: from ? { cursor: from.cursor, pagesRead: 1 } : undefined,
        onPage: ({ rows, body, index }) => {
          if (commit === 'at-end' || isStale()) return
          const page = withNewerReads(rows.map(toFileItem))
          const replaces = index === 0 && !from
          if (replaces) setCollectionName(body.collectionName)
          setFiles((previous) => (replaces ? page : appendPage(previous, page)))
          shownUrl.current = url
          if (showsSkeleton) setIsLoading(false)
        },
      })
        .then(({ first, documents, truncated: stoppedEarly }) => {
          if (isStale()) return
          if (commit === 'at-end') {
            setCollectionName(first.collectionName)
            setFiles(withNewerReads(documents.map(toFileItem)))
          }
          shownUrl.current = url
          setTruncated(stoppedEarly)
          setComplete(true)
        })
        .catch(() => {
          if (isStale()) return
          if (commit === 'per-page') setComplete(true)
          if (quiet) return
          shownUrl.current = null
          setFiles([])
          setError(true)
          setComplete(true)
        })
        .finally(() => {
          if (showsSkeleton) setIsLoading(false)
        })
    },
    [url, beginLoad, enabled]
  )

  const load = useCallback((quiet = false) => drain({ quiet }), [drain])

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  const quietInFlight = useRef(false)
  const quietQueued = useRef(false)
  const reloadQuietly = useCallback(() => {
    if (quietInFlight.current) {
      quietQueued.current = true
      return
    }
    const run = (): void => {
      quietInFlight.current = true
      void loadRef.current(true).finally(() => {
        quietInFlight.current = false
        if (!quietQueued.current) return
        quietQueued.current = false
        run()
      })
    }
    run()
  }, [])

  const seed = useRef<{ next: string | null } | null>(seededWith ? { next: initialNextCursor } : null)
  useEffect(() => {
    const seeded = seed.current
    seed.current = null
    if (!seeded) {
      void drain({ quiet: false })
      return
    }
    if (seeded.next !== null) void drain({ quiet: true, from: { cursor: seeded.next } })
  }, [drain])

  return { files, setFiles, isLoading, complete, error, truncated, collectionName, load, reloadQuietly }
}

function listingUrl(list: string, paramsKey: string, agentAuthoredOnly: boolean, includeArchived: boolean): string {
  const params = new URLSearchParams(JSON.parse(paramsKey) as Record<string, string>)
  if (agentAuthoredOnly) params.set('authoredBy', 'agent')
  if (includeArchived) params.set('includeArchived', 'true')
  const query = params.toString()
  return query ? `${list}?${query}` : list
}
