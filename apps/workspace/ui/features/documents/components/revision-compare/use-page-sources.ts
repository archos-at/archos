'use client'

import { useEffect, useState } from 'react'
import {
  NotComparableError,
  type CompareFile,
  type PageSize,
  type PageSource,
  type SourceLoader,
} from './types'

export type SideState =
  | { status: 'loading' }
  | { status: 'ready'; source: PageSource }
  | { status: 'not-comparable' }
  | { status: 'failed' }

export function usePageSource(file: CompareFile, loadSource: SourceLoader, attempt = 0): SideState {
  const { id, filename } = file
  const [state, setState] = useState<SideState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    let opened: PageSource | null = null
    setState({ status: 'loading' })
    loadSource({ id, filename })
      .then((source) => {
        if (cancelled) {
          source.destroy()
          return
        }
        opened = source
        setState({ status: 'ready', source })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({ status: error instanceof NotComparableError ? 'not-comparable' : 'failed' })
      })
    return () => {
      cancelled = true
      opened?.destroy()
    }
  }, [id, filename, loadSource, attempt])

  return state
}

export function usePageSize(source: PageSource | null, page: number): PageSize | null {
  const [sized, setSized] = useState<{ source: PageSource; page: number; size: PageSize } | null>(
    null,
  )

  useEffect(() => {
    if (!source || page < 1 || page > source.pageCount) return
    let cancelled = false
    source
      .pageSize(page)
      .then((size) => {
        if (!cancelled) setSized({ source, page, size })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [source, page])

  return sized && sized.source === source && sized.page === page ? sized.size : null
}
