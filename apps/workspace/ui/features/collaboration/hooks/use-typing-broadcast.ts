'use client'

import { useCallback, useEffect, useRef } from 'react'
import { TYPING_REFRESH_MS } from '@/lib/conversations/presence-contract'

const TYPING_IDLE_MS = 45_000

export interface UseTypingBroadcastOptions {
  conversationId: string | null
  enabled: boolean
}

export interface UseTypingBroadcastResult {
  onTyping: () => void
  onStoppedTyping: () => void
}

export function useTypingBroadcast(
  options: UseTypingBroadcastOptions,
): UseTypingBroadcastResult {
  const { conversationId, enabled } = options

  const lastPublishedAtRef = useRef(0)
  const conversationIdRef = useRef(conversationId)
  conversationIdRef.current = conversationId
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const lastKeystrokeAtRef = useRef(0)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const publish = useCallback((typing: boolean, conversation?: string) => {
    const id = conversation ?? conversationIdRef.current
    if (!id) return
    void fetch(`/api/conversations/${encodeURIComponent(id)}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typing }),
      keepalive: true,
    }).catch(() => {
      // Deliberately silent — see the module comment.
    })
  }, [])

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current === null) return
    clearInterval(heartbeatRef.current)
    heartbeatRef.current = null
  }, [])

  const onStoppedTyping = useCallback(() => {
    stopHeartbeat()
    if (lastPublishedAtRef.current === 0) return
    lastPublishedAtRef.current = 0
    publish(false)
  }, [publish, stopHeartbeat])

  const onTyping = useCallback(() => {
    if (!enabledRef.current) return
    const now = Date.now()
    lastKeystrokeAtRef.current = now
    if (heartbeatRef.current === null) {
      heartbeatRef.current = setInterval(() => {
        if (!enabledRef.current) {
          onStoppedTyping()
          return
        }
        if (Date.now() - lastKeystrokeAtRef.current > TYPING_IDLE_MS) {
          onStoppedTyping()
          return
        }
        lastPublishedAtRef.current = Date.now()
        publish(true)
      }, TYPING_REFRESH_MS)
    }
    if (now - lastPublishedAtRef.current < TYPING_REFRESH_MS) return
    lastPublishedAtRef.current = now
    publish(true)
  }, [publish, onStoppedTyping])

  useEffect(
    () => () => {
      stopHeartbeat()
      if (lastPublishedAtRef.current === 0) return
      lastPublishedAtRef.current = 0
      publish(false)
    },
    [publish, stopHeartbeat]
  )

  const previousConversationRef = useRef(conversationId)
  useEffect(() => {
    const previous = previousConversationRef.current
    previousConversationRef.current = conversationId
    if (previous === conversationId) return
    stopHeartbeat()
    if (lastPublishedAtRef.current === 0) return
    lastPublishedAtRef.current = 0
    if (!previous) return
    publish(false, previous)
  }, [conversationId, publish, stopHeartbeat])

  return { onTyping, onStoppedTyping }
}
