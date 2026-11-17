'use client'

import { useCallback, useEffect, useState } from 'react'

export type Load<T> = { state: 'loading' } | { state: 'error'; status: number } | { state: 'ready'; value: T }

export function usePlatformJson<T>(url: string | null): { load: Load<T>; reload: () => void } {
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' })
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    void (async () => {
      const response = await fetch(url).catch(() => null)
      if (cancelled) return
      if (!response || !response.ok) {
        setLoad({ state: 'error', status: response?.status ?? 0 })
        return
      }
      const body = (await response.json().catch(() => null)) as T | null
      if (cancelled) return
      setLoad(body === null ? { state: 'error', status: 0 } : { state: 'ready', value: body })
    })()
    return () => {
      cancelled = true
    }
  }, [url, round])

  const reload = useCallback(() => setRound((value) => value + 1), [])
  return { load, reload }
}
