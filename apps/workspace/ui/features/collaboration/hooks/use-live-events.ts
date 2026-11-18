'use client'

import { useEffect, useRef, useState } from 'react'
import type { CollaborationEvent } from '@/lib/events/types'
import { subscribeToConnection, subscribeToEvents } from '../lib/event-hub'

const DISCONNECTED_POLL_MS = 60_000

export interface UseLiveEventsOptions {
  enabled?: boolean
  onEvent?: (event: CollaborationEvent) => void
  onRefresh?: () => void
}

export interface UseLiveEventsResult {
  connected: boolean
}

export function useLiveEvents(options: UseLiveEventsOptions = {}): UseLiveEventsResult {
  const { enabled = true, onEvent, onRefresh } = options
  const [connected, setConnected] = useState(false)

  const onEventRef = useRef(onEvent)
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => {
    onEventRef.current = onEvent
    onRefreshRef.current = onRefresh
  }, [onEvent, onRefresh])

  useEffect(() => {
    if (!enabled) {
      setConnected(false)
      return
    }
    const unsubscribeEvents = subscribeToEvents((event) => onEventRef.current?.(event))
    const unsubscribeConnection = subscribeToConnection(setConnected)
    return () => {
      unsubscribeEvents()
      unsubscribeConnection()
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const refresh = () => onRefreshRef.current?.()
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled || connected) return
    const timer = setInterval(() => onRefreshRef.current?.(), DISCONNECTED_POLL_MS)
    return () => clearInterval(timer)
  }, [enabled, connected])

  return { connected }
}
