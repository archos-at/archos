'use client'

import { useSyncExternalStore } from 'react'

const notOnServer = new Set<string>()
const confirmedAt = new Map<string, number>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function markConversationMinted(conversationId: string): void {
  if (notOnServer.has(conversationId)) return
  notOnServer.add(conversationId)
  emit()
}

export function markConversationOnServer(conversationId: string): void {
  if (!notOnServer.delete(conversationId)) return
  confirmedAt.set(conversationId, Date.now())
  emit()
}

export function wasOnServerBefore(conversationId: string, time: number): boolean {
  if (notOnServer.has(conversationId)) return false
  const confirmed = confirmedAt.get(conversationId)
  return confirmed === undefined || confirmed < time
}

export function whenConversationOnServer(conversationId: string, callback: () => void): void {
  if (!notOnServer.has(conversationId)) {
    callback()
    return
  }
  const listener = (): void => {
    if (notOnServer.has(conversationId)) return
    listeners.delete(listener)
    callback()
  }
  listeners.add(listener)
}

export function isConversationOnServer(conversationId: string | null | undefined): boolean {
  return Boolean(conversationId) && !notOnServer.has(conversationId as string)
}

export function useConversationOnServer(conversationId: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isConversationOnServer(conversationId),
    () => isConversationOnServer(conversationId)
  )
}

export function resetConversationsOnServer(): void {
  confirmedAt.clear()
  if (notOnServer.size === 0) return
  notOnServer.clear()
  emit()
}
