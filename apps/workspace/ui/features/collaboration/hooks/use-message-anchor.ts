'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const HIGHLIGHT_MS = 2600

const ANCHOR_PREFIX = '#message-'

export function messageIdFromHash(hash: string | null | undefined): string | null {
  if (!hash || !hash.startsWith(ANCHOR_PREFIX)) return null
  const id = decodeURIComponent(hash.slice(ANCHOR_PREFIX.length))
  return id.length > 0 ? id : null
}

export interface MessageAnchorOptions {
  onLand?: (messageId: string) => void
  conversationId?: string | null
  ready?: boolean
}

export interface MessageAnchor {
  highlightedId: string | null
  isTargetPending: () => boolean
}

const sessionFromUrl = (): string | null =>
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('session')

export function useMessageAnchor(
  messageIds: readonly string[],
  { onLand, conversationId = null, ready = false }: MessageAnchorOptions = {}
): MessageAnchor {
  const pendingRef = useRef<string | null | undefined>(undefined)
  const boundRef = useRef<string | null>(null)
  if (pendingRef.current === undefined) {
    pendingRef.current =
      typeof window === 'undefined' ? null : messageIdFromHash(window.location.hash)
    boundRef.current = sessionFromUrl()
  }
  const onLandRef = useRef(onLand)
  onLandRef.current = onLand

  const shownRef = useRef(conversationId)
  const missedInRef = useRef<string | null | undefined>(undefined)
  const blockingRef = useRef(false)
  if (shownRef.current !== conversationId) {
    if (missedInRef.current === shownRef.current && conversationId !== boundRef.current) {
      pendingRef.current = null
    }
    shownRef.current = conversationId
  }
  const missing = Boolean(pendingRef.current) && ready && !messageIds.includes(pendingRef.current ?? '')
  if (missing) missedInRef.current = conversationId
  blockingRef.current = Boolean(pendingRef.current) && !missing

  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [hashTick, setHashTick] = useState(0)

  useEffect(() => {
    const onHashChange = () => {
      const target = messageIdFromHash(window.location.hash)
      if (!target) return
      pendingRef.current = target
      boundRef.current = shownRef.current
      missedInRef.current = undefined
      blockingRef.current = true
      setHashTick((tick) => tick + 1)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const target = pendingRef.current
    if (!target || !messageIds.includes(target)) return

    const element = document.getElementById(`message-${target}`)
    if (!element) return

    pendingRef.current = null
    blockingRef.current = false
    element.scrollIntoView({ behavior: 'auto', block: 'center' })
    setHighlighted(target)
    onLandRef.current?.(target)

    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [messageIds, hashTick])

  useEffect(() => {
    if (!highlighted) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setHighlighted(null), HIGHLIGHT_MS)
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [highlighted])

  const isTargetPending = useCallback(() => blockingRef.current, [])

  return { highlightedId: highlighted, isTargetPending }
}
