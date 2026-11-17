'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchShelfSummary } from '@/lib/documents/level-client'
import type { ShelfSummary } from '@/lib/documents/shelf-summary-types'

export interface ShelfSummaryState {
  summary: ShelfSummary | null
  error: boolean
  reload: () => Promise<void>
}

export function useShelfSummary({ url, fetcher }: { url: string | null; fetcher?: typeof fetch }): ShelfSummaryState {
  const [summary, setSummary] = useState<ShelfSummary | null>(null)
  const [error, setError] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const currentUrl = useRef<string | null>(null)

  const read = useCallback(
    async (target: string) => {
      controller.current?.abort()
      const own = new AbortController()
      controller.current = own
      try {
        const next = await fetchShelfSummary(target, { signal: own.signal, fetcher })
        if (controller.current !== own) return
        setSummary(next)
        setError(false)
      } catch {
        if (own.signal.aborted || controller.current !== own) return
        setError(true)
      }
    },
    [fetcher]
  )

  useEffect(() => {
    currentUrl.current = url
    if (url === null) {
      controller.current?.abort()
      return
    }
    void read(url)
  }, [url, read])

  useEffect(() => () => controller.current?.abort(), [])

  const reload = useCallback((): Promise<void> => {
    const target = currentUrl.current
    return target ? read(target) : Promise.resolve()
  }, [read])

  return { summary, error, reload }
}
