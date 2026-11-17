'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  KnowledgeBaseStatus,
  KnowledgeFile,
  KnowledgeFileState,
} from '@/lib/knowledge/service'

export const POLL_INTERVAL_MS = 3_500
export const MAX_POLLS = 60
export const MISSING_AFTER_MS = 45_000

export type WatchItemPhase = 'working' | 'done' | 'missing'

export interface WatchItem {
  name: string
  phase: WatchItemPhase
  state: KnowledgeFileState | null
}

export function classifyWatched(
  files: readonly KnowledgeFile[],
  watched: ReadonlyMap<string, number>,
  now: number
): WatchItem[] {
  const byName = new Map(files.map((file) => [file.fileName, file]))
  return [...watched].map(([name, since]) => {
    const file = byName.get(name)
    if (file)
      return { name, phase: file.state === 'pending' ? 'working' : 'done', state: file.state }
    return { name, phase: now - since >= MISSING_AFTER_MS ? 'missing' : 'working', state: null }
  })
}

export interface IngestWatch {
  items: WatchItem[]
  timedOut: boolean
  missing: string[]
  watch: (names: readonly string[]) => void
  rearm: () => void
  dismissMissing: () => void
}

export function useIngestWatch(
  fetchStatus: () => Promise<KnowledgeBaseStatus>,
  onStatus: (status: KnowledgeBaseStatus) => void,
  files: readonly KnowledgeFile[]
): IngestWatch {
  const [watched, setWatched] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [timedOut, setTimedOut] = useState(false)
  const [missing, setMissing] = useState<string[]>([])
  const [now, setNow] = useState(() => Date.now())

  const watchedRef = useRef<ReadonlyMap<string, number>>(new Map())
  const generationRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchRef = useRef(fetchStatus)
  const onStatusRef = useRef(onStatus)
  useEffect(() => {
    fetchRef.current = fetchStatus
    onStatusRef.current = onStatus
  }, [fetchStatus, onStatus])

  const cancel = useCallback(() => {
    generationRef.current += 1
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(() => cancel, [cancel])

  const setWatchedBoth = useCallback((next: ReadonlyMap<string, number>) => {
    watchedRef.current = next
    setWatched(next)
  }, [])

  const run = useCallback(() => {
    cancel()
    const generation = generationRef.current
    let polls = 0
    setTimedOut(false)

    const tick = async (): Promise<void> => {
      timerRef.current = null
      polls += 1
      let status: KnowledgeBaseStatus | null = null
      try {
        status = await fetchRef.current()
      } catch {
        // A transient failure: keep polling until the ceiling.
      }
      if (generation !== generationRef.current) return

      const at = Date.now()
      setNow(at)
      if (status) onStatusRef.current(status)

      const items = status ? classifyWatched(status.files, watchedRef.current, at) : null
      if (items && !items.some((item) => item.phase === 'working')) {
        setMissing(items.filter((item) => item.phase === 'missing').map((item) => item.name))
        setWatchedBoth(new Map())
        return
      }
      if (polls >= MAX_POLLS) {
        setTimedOut(true)
        return
      }
      timerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS)
    }

    timerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS)
  }, [cancel, setWatchedBoth])

  const watch = useCallback(
    (names: readonly string[]) => {
      if (names.length === 0) return
      const at = Date.now()
      const next = new Map(watchedRef.current)
      for (const name of names) next.set(name, at)
      setWatchedBoth(next)
      setNow(at)
      setMissing((prev) => prev.filter((name) => !names.includes(name)))
      run()
    },
    [run, setWatchedBoth]
  )

  const rearm = useCallback(() => {
    if (watchedRef.current.size === 0) return
    const at = Date.now()
    setWatchedBoth(new Map([...watchedRef.current.keys()].map((name) => [name, at])))
    setNow(at)
    run()
  }, [run, setWatchedBoth])

  const dismissMissing = useCallback(() => setMissing([]), [])

  return {
    items: watched.size === 0 ? [] : classifyWatched(files, watched, now),
    timedOut,
    missing,
    watch,
    rearm,
    dismissMissing,
  }
}
