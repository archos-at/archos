'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { listProjectAnnotations } from '@/lib/annotations/client'
import {
  MAX_PROJECT_MARKS_PAGE,
  PROJECT_MARKS_PAGE_SIZE,
  type ProjectMarksFilters,
  type ProjectMarksResponse,
  type ProjectMarkView,
} from '@/lib/annotations/project-types'

export interface ProjectMarksState {
  marks: ProjectMarkView[]
  load: 'loading' | 'ready' | 'error'
  hasMore: boolean
  more: 'idle' | 'loading' | 'error'
  restricted: boolean | null
  retry: () => void
  loadMore: () => void
}

export function useProjectMarks(
  projectId: string,
  filters: ProjectMarksFilters,
  initial: { page: ProjectMarksResponse | null; filters: ProjectMarksFilters } | null = null
): ProjectMarksState {
  const key = JSON.stringify(filters)
  const seeded = initial?.page && JSON.stringify(initial.filters) === key ? initial.page : null
  const [marks, setMarks] = useState<ProjectMarkView[]>(seeded?.marks ?? [])
  const [cursor, setCursor] = useState<string | null>(seeded?.nextCursor ?? null)
  const [load, setLoad] = useState<ProjectMarksState['load']>(seeded ? 'ready' : 'loading')
  const [restricted, setRestricted] = useState<boolean | null>(seeded?.restricted ?? null)
  const [more, setMore] = useState<ProjectMarksState['more']>('idle')
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  const quietFirst = useRef(seeded !== null)
  const shown = useRef({ count: marks.length, ready: load === 'ready' })
  useEffect(() => {
    shown.current = { count: marks.length, ready: load === 'ready' }
  }, [marks.length, load])

  const readFirst = useCallback(
    (quiet: boolean) => {
      const read = ++latest.current
      if (!quiet) {
        setLoad('loading')
        setRestricted(null)
      }
      setMore('idle')
      const covered = Math.min(shown.current.count, MAX_PROJECT_MARKS_PAGE)
      const page = quiet && covered > PROJECT_MARKS_PAGE_SIZE ? { limit: covered } : {}
      listProjectAnnotations(projectId, JSON.parse(key) as ProjectMarksFilters, page)
        .then((answer) => {
          if (latest.current !== read) return
          setMarks(answer.marks)
          setCursor(answer.nextCursor)
          setRestricted(answer.restricted ?? null)
          setLoad('ready')
        })
        .catch(() => {
          if (latest.current === read && !quiet) setLoad('error')
        })
    },
    [projectId, key]
  )

  const lastRead = useRef<string | null>(null)
  useEffect(() => {
    const id = `${key}\n${attempt}`
    const quiet = lastRead.current === id || (lastRead.current === null && quietFirst.current)
    lastRead.current = id
    readFirst(quiet)
  }, [readFirst, key, attempt])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && shown.current.ready) readFirst(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [readFirst])

  const loadMore = useCallback(() => {
    if (!cursor || more === 'loading') return
    const read = ++latest.current
    setMore('loading')
    listProjectAnnotations(projectId, JSON.parse(key) as ProjectMarksFilters, { cursor })
      .then((page) => {
        if (latest.current !== read) return
        setMarks((shown) => [...shown, ...page.marks])
        setCursor(page.nextCursor)
        setMore('idle')
      })
      .catch(() => {
        if (latest.current === read) setMore('error')
      })
  }, [projectId, key, cursor, more])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  return { marks, load, restricted, hasMore: cursor !== null, more, retry, loadMore }
}
