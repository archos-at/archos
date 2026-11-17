'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatUsageNotice } from '@/lib/budgets/usage-notice'

export const AFTER_TURN_REFRESH_MS = 3_000
export const STALE_AFTER_MS = 60_000
export const MAX_TIMER_MS = 6 * 60 * 60_000

export function useUsageNotice(options: {
  enabled: boolean
  projectId: string | null
  isStreaming: boolean
}): ChatUsageNotice | null {
  const { enabled, projectId, isStreaming } = options
  const [held, setHeld] = useState<{ projectId: string | null; notice: ChatUsageNotice | null }>({
    projectId,
    notice: null,
  })
  const notice = held.projectId === projectId ? held.notice : null
  const lastReadAt = useRef(0)
  const generation = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) return
    const mine = ++generation.current
    lastReadAt.current = Date.now()
    try {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
      const res = await fetch(`/api/organization/usage/notice${query}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (!res.ok) return
      const body = (await res.json()) as { notice?: ChatUsageNotice | null }
      if (mine === generation.current) setHeld({ projectId, notice: body.notice ?? null })
    } catch {
      // Keep what is shown.
    }
  }, [enabled, projectId])

  useEffect(() => {
    setHeld({ projectId, notice: null })
    void refresh()
  }, [refresh, projectId])

  const wasStreaming = useRef(isStreaming)
  useEffect(() => {
    const ended = wasStreaming.current && !isStreaming
    wasStreaming.current = isStreaming
    if (!ended) return
    const timer = setTimeout(() => void refresh(), AFTER_TURN_REFRESH_MS)
    return () => clearTimeout(timer)
  }, [isStreaming, refresh])

  useEffect(() => {
    if (!enabled) return
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && Date.now() - lastReadAt.current >= STALE_AFTER_MS) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [enabled, refresh])

  const resetsAt = notice?.resetsAt
  useEffect(() => {
    if (!resetsAt) return
    const due = Date.parse(resetsAt) + 5_000
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = (): void => {
      const remaining = due - Date.now()
      if (remaining <= 0) {
        void refresh()
        return
      }
      timer = setTimeout(arm, Math.max(1_000, Math.min(remaining, MAX_TIMER_MS)))
    }
    arm()
    return () => clearTimeout(timer)
  }, [resetsAt, refresh])

  return notice
}

const DISMISSED_KEY = 'usage-notice.dismissed'
const DISMISSED_KEPT = 20

export const readDismissedNotices = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
  } catch {
    return []
  }
}

export const rememberDismissedNotice = (key: string): void => {
  try {
    const kept = [...readDismissedNotices().filter((existing) => existing !== key), key].slice(-DISMISSED_KEPT)
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(kept))
  } catch {
    // Dismissed for this page view only.
  }
}
