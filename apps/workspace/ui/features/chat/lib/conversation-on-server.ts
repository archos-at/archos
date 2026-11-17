'use client'

import { useSyncExternalStore } from 'react'

const notOnServer = new Set<string>()
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
  emit()
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
  if (notOnServer.size === 0) return
  notOnServer.clear()
  emit()
}
