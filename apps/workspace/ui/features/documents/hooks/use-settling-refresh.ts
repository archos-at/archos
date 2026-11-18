'use client'

import { useEffect, useMemo, useRef } from 'react'
import { notifyDocumentsChanged } from '@/lib/documents/document-changes'
import { isSettlingStatus } from '../components/document-status'

export const SETTLING_POLL_MS = 4_000

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

interface SettlingItem {
  status: string | null | undefined
  pending?: boolean
}

export function useSettlingRefresh(
  items: readonly SettlingItem[],
  refresh: (quiet?: boolean) => Promise<unknown>,
  intervalMs: number = SETTLING_POLL_MS
): void {
  const hasSettlingItem = useMemo(
    () => items.some((item) => item.pending === true || isSettlingStatus(item.status)),
    [items]
  )

  const wasSettling = useRef(false)
  useEffect(() => {
    if (wasSettling.current && !hasSettlingItem && items.length > 0) notifyDocumentsChanged()
    wasSettling.current = hasSettlingItem
  }, [hasSettlingItem, items.length])

  useEffect(() => {
    if (!hasSettlingItem) return
    let cancelled = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (!cancelled) timer = setTimeout(tick, intervalMs)
    }
    const tick = () => {
      timer = null
      if (isDocumentHidden()) return
      inFlight = true
      void refresh(true).finally(() => {
        inFlight = false
        schedule()
      })
    }
    const onVisibilityChange = () => {
      if (cancelled || inFlight || isDocumentHidden()) return
      if (timer) clearTimeout(timer)
      tick()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    schedule()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [hasSettlingItem, refresh, intervalMs])
}
