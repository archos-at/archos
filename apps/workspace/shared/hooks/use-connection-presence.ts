'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type ConnectionPresence = 'connected' | 'reconnecting' | 'offline'

export interface UseConnectionPresenceOptions {
  pingUrl?: string
  pingIntervalMs?: number
  pingTimeoutMs?: number
  debounceMs?: number
  enablePing?: boolean
}

const DEFAULT_PING_URL = '/api/health'
const DEFAULT_PING_INTERVAL_MS = 20_000
const DEFAULT_PING_TIMEOUT_MS = 5_000
const DEFAULT_DEBOUNCE_MS = 400

export function useConnectionPresence(
  options: UseConnectionPresenceOptions = {},
): ConnectionPresence {
  const {
    pingUrl = DEFAULT_PING_URL,
    pingIntervalMs = DEFAULT_PING_INTERVAL_MS,
    pingTimeoutMs = DEFAULT_PING_TIMEOUT_MS,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    enablePing = true,
  } = options

  const [presence, setPresence] = useState<ConnectionPresence>('connected')

  const onlineRef = useRef(true)
  const healthyRef = useRef<boolean | null>(null)
  const committedRef = useRef<ConnectionPresence>('connected')
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const deriveTarget = useCallback((): ConnectionPresence => {
    if (!onlineRef.current) return 'offline'
    if (healthyRef.current === false) return 'reconnecting'
    return 'connected'
  }, [])

  const clearDebounce = useCallback((): void => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }, [])

  const scheduleCommit = useCallback((): void => {
    const target = deriveTarget()
    if (target === committedRef.current) {
      clearDebounce()
      return
    }
    clearDebounce()
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      const next = deriveTarget()
      committedRef.current = next
      setPresence(next)
    }, debounceMs)
  }, [clearDebounce, debounceMs, deriveTarget])

  const runPing = useCallback(async (): Promise<void> => {
    if (!enablePing) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    if (typeof fetch === 'undefined') return

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), pingTimeoutMs)
    try {
      const res = await fetch(pingUrl, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })
      healthyRef.current = res.ok
    } catch {
      healthyRef.current = false
    } finally {
      clearTimeout(timeout)
      scheduleCommit()
    }
  }, [enablePing, pingTimeoutMs, pingUrl, scheduleCommit])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return

    onlineRef.current = navigator.onLine
    scheduleCommit()

    const handleOnline = (): void => {
      onlineRef.current = true
      healthyRef.current = null
      scheduleCommit()
      void runPing()
    }
    const handleOffline = (): void => {
      onlineRef.current = false
      scheduleCommit()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [runPing, scheduleCommit])

  useEffect(() => {
    if (!enablePing) return
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    let intervalId: ReturnType<typeof setInterval> | null = null

    const start = (): void => {
      if (intervalId !== null) return
      void runPing() // immediate check on (re)start
      intervalId = setInterval(() => {
        void runPing()
      }, pingIntervalMs)
    }
    const stop = (): void => {
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      stop()
    }
  }, [enablePing, pingIntervalMs, runPing])

  useEffect(() => {
    if (!enablePing || typeof window === 'undefined') return
    const check = (): void => {
      void runPing()
    }
    window.addEventListener(CHECK_EVENT, check)
    return () => window.removeEventListener(CHECK_EVENT, check)
  }, [enablePing, runPing])

  useEffect(() => clearDebounce, [clearDebounce])

  return presence
}

const CHECK_EVENT = 'connection-presence:check'

export function requestConnectionCheck(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHECK_EVENT))
}
