'use client'

import { useEffect } from 'react'

const MARK_READ_DEBOUNCE_MS = 1_200
const MARK_READ_RETRY_MS = 8_000
const MARK_READ_MAX_ATTEMPTS = 3

interface ThreadReadReceiptOptions {
  enabled: boolean
  shared: boolean
  base: string | null
  active: boolean
  newestMessageId: string | null
  reportedReadIdRef: { current: string | null }
  markReadTimerRef: { current: ReturnType<typeof setTimeout> | null }
}

export function useThreadReadReceipt({
  enabled,
  shared,
  base,
  active,
  newestMessageId,
  reportedReadIdRef,
  markReadTimerRef,
}: ThreadReadReceiptOptions): void {
  useEffect(() => {
    if (!enabled || !shared || !base || !active) return
    const newest = newestMessageId
    if (!newest || newest === reportedReadIdRef.current) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    let attempts = 0
    let left = false
    const report = () => {
      reportedReadIdRef.current = newest
      void fetch(`${base}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastReadMessageId: newest }),
      })
        .then((response) => {
          if (!response.ok) throw new Error(`read receipt failed: ${response.status}`)
        })
        .catch(() => {
          if (reportedReadIdRef.current === newest) reportedReadIdRef.current = null
          if (left || ++attempts >= MARK_READ_MAX_ATTEMPTS) return
          markReadTimerRef.current = setTimeout(report, MARK_READ_RETRY_MS)
        })
    }
    markReadTimerRef.current = setTimeout(report, MARK_READ_DEBOUNCE_MS)

    return () => {
      left = true
      if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current)
      markReadTimerRef.current = null
    }
  }, [enabled, shared, base, active, newestMessageId, reportedReadIdRef, markReadTimerRef])
}
