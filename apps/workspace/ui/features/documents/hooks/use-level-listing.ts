'use client'

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  fetchLevelPage,
  levelPageUrl,
  withQueryParam,
  type LevelPageRequest,
} from '@/lib/documents/level-client'
import { toFileItem, type DocumentWireRow } from '../lib/file-item'
import type { FileItem } from '../file-types'
import { useSettlingRefresh } from './use-settling-refresh'
import { useSettlingStatusReads } from './use-settling-status-reads'

export const LEVEL_PAGE_SIZE = 100

const RELOAD_LIMIT_MAX = 500

export interface LevelListingOptions {
  request: Omit<LevelPageRequest, 'limit'> | null
  resetKey: string
  pageSize?: number
  initialPage?: { rows: readonly DocumentWireRow[]; nextCursor: string | null }
  fetcher?: typeof fetch
}

export interface LevelListing {
  files: FileItem[]
  setFiles: Dispatch<SetStateAction<FileItem[]>>
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  error: boolean
  moreError: boolean
  collectionName: string | undefined
  loadMore: () => void
  reload: (quiet?: boolean) => Promise<void>
}

function appendPage(previous: FileItem[], page: FileItem[]): FileItem[] {
  if (page.length === 0) return previous
  const held = new Set(previous.map((file) => file.id))
  const fresh = page.filter((file) => !held.has(file.id))
  return fresh.length === 0 ? previous : [...previous, ...fresh]
}

export function useLevelListing({
  request,
  resetKey,
  pageSize = LEVEL_PAGE_SIZE,
  initialPage,
  fetcher,
}: LevelListingOptions): LevelListing {
  const url = request ? levelPageUrl({ ...request, limit: pageSize }) : null

  const [files, setFiles] = useState<FileItem[]>(() => (initialPage?.rows ?? []).map(toFileItem))
  const [isLoading, setIsLoading] = useState(url !== null && initialPage === undefined)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [nextCursor, setNextCursorState] = useState<string | null>(initialPage?.nextCursor ?? null)
  const [error, setError] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const [collectionName, setCollectionName] = useState<string | undefined>(undefined)

  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const currentUrl = useRef<string | null>(null)
  const cursor = useRef<string | null>(initialPage?.nextCursor ?? null)
  const loadingMore = useRef(false)
  const filesRef = useRef(files)
  useEffect(() => {
    filesRef.current = files
  }, [files])

  const setNextCursor = useCallback((next: string | null) => {
    cursor.current = next
    setNextCursorState(next)
  }, [])

  const settlingReads = useSettlingStatusReads(files, setFiles, { fetcher })
  const { beginLoad } = settlingReads
  useSettlingRefresh(files, settlingReads.tick)

  const loadFirst = useCallback(
    async (target: string, { clear, quiet, limit }: { clear: boolean; quiet: boolean; limit?: number }) => {
      controller.current?.abort()
      const own = new AbortController()
      controller.current = own
      currentUrl.current = target
      const stamp = ++generation.current
      loadingMore.current = false
      setIsLoadingMore(false)
      setMoreError(false)
      const withNewerReads = beginLoad()
      if (clear) {
        setFiles([])
        setNextCursor(null)
      }
      if (!quiet) {
        setIsLoading(true)
        setError(false)
      }
      try {
        const page = await fetchLevelPage(limit ? withQueryParam(target, 'limit', String(limit)) : target, {
          signal: own.signal,
          fetcher,
        })
        if (stamp !== generation.current) return
        setFiles(withNewerReads(page.documents.map(toFileItem)))
        setNextCursor(page.nextCursor)
        if (page.collectionName) setCollectionName(page.collectionName)
        setError(false)
        setIsLoading(false)
      } catch {
        if (own.signal.aborted || stamp !== generation.current) return
        if (quiet) return
        setFiles([])
        setNextCursor(null)
        setError(true)
      } finally {
        if (!quiet && stamp === generation.current) setIsLoading(false)
      }
    },
    [beginLoad, fetcher, setNextCursor]
  )

  const seededUrl = useRef<string | null>(initialPage !== undefined ? url : null)
  const lastResetKey = useRef<string | null>(null)
  useEffect(() => {
    const seeded = seededUrl.current
    seededUrl.current = null
    const reset = lastResetKey.current !== resetKey
    lastResetKey.current = resetKey
    if (url === null) {
      controller.current?.abort()
      currentUrl.current = null
      generation.current += 1
      setIsLoading(false)
      return
    }
    if (seeded !== null && seeded === url) {
      currentUrl.current = url
      return
    }
    void loadFirst(url, { clear: reset, quiet: false })
  }, [url, resetKey, loadFirst])

  useEffect(() => () => controller.current?.abort(), [])

  const loadMore = useCallback(() => {
    const after = cursor.current
    const target = currentUrl.current
    if (!after || !target || loadingMore.current) return
    loadingMore.current = true
    setIsLoadingMore(true)
    setMoreError(false)
    const stamp = generation.current
    const signal = controller.current?.signal
    const withNewerReads = beginLoad()
    fetchLevelPage(withQueryParam(target, 'cursor', after), { signal, fetcher })
      .then((page) => {
        if (stamp !== generation.current || cursor.current !== after) return
        setFiles((previous) => appendPage(previous, withNewerReads(page.documents.map(toFileItem))))
        setNextCursor(page.nextCursor)
      })
      .catch(() => {
        if (signal?.aborted || stamp !== generation.current) return
        setMoreError(true)
      })
      .finally(() => {
        if (stamp !== generation.current) return
        loadingMore.current = false
        setIsLoadingMore(false)
      })
  }, [beginLoad, fetcher, setNextCursor])

  const reload = useCallback(
    (quiet = true): Promise<void> => {
      const target = currentUrl.current
      if (!target) return Promise.resolve()
      const limit = Math.min(RELOAD_LIMIT_MAX, Math.max(pageSize, filesRef.current.length))
      return loadFirst(target, { clear: false, quiet, limit })
    },
    [loadFirst, pageSize]
  )

  return {
    files,
    setFiles,
    isLoading,
    isLoadingMore,
    hasMore: nextCursor !== null,
    error,
    moreError,
    collectionName,
    loadMore,
    reload,
  }
}
