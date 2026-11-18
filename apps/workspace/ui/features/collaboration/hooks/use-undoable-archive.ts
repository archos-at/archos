'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export const ARCHIVE_UNDO_MS = 5000

export interface UndoableArchive {
  pendingIds: ReadonlySet<string>
  request: (itemId: string) => void
  undo: (itemId: string) => void
}

export function useUndoableArchive(
  archive: (itemId: string) => Promise<void>,
  delayMs: number = ARCHIVE_UNDO_MS,
): UndoableArchive {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const archiveRef = useRef(archive)
  useEffect(() => {
    archiveRef.current = archive
  }, [archive])

  const forget = useCallback((itemId: string): void => {
    setPendingIds((current) => {
      if (!current.has(itemId)) return current
      const next = new Set(current)
      next.delete(itemId)
      return next
    })
  }, [])

  const commit = useCallback(
    (itemId: string): void => {
      const timer = timers.current.get(itemId)
      if (timer === undefined) return
      clearTimeout(timer)
      timers.current.delete(itemId)
      void archiveRef.current(itemId).finally(() => forget(itemId))
    },
    [forget],
  )

  const request = useCallback(
    (itemId: string): void => {
      if (timers.current.has(itemId)) return
      setPendingIds((current) => new Set(current).add(itemId))
      timers.current.set(
        itemId,
        setTimeout(() => commit(itemId), delayMs),
      )
    },
    [commit, delayMs],
  )

  const undo = useCallback(
    (itemId: string): void => {
      const timer = timers.current.get(itemId)
      if (timer === undefined) return
      clearTimeout(timer)
      timers.current.delete(itemId)
      forget(itemId)
    },
    [forget],
  )

  useEffect(() => {
    const flush = (): void => {
      for (const itemId of [...timers.current.keys()]) commit(itemId)
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [commit])

  return { pendingIds, request, undo }
}
