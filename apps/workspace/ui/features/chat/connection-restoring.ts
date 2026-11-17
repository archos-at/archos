import { useSyncExternalStore } from 'react'
import { CONNECTION_WAIT_NOTE_AFTER_MS, watchConnectionWait } from '@/adapters/api/connection-wait'
import type { TurnSocketStatus } from '@/adapters/api/turn-socket'
import { useChatStore } from './store'

export const RESTORING_NOTE_AFTER_MS = CONNECTION_WAIT_NOTE_AFTER_MS

const restoring = new Set<string>()
const listeners = new Set<() => void>()

const mark = (conversationId: string, on: boolean): void => {
  if (restoring.has(conversationId) === on) return
  if (on) restoring.add(conversationId)
  else restoring.delete(conversationId)
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const watchRestoring = (
  conversationId: string,
  onStatus: (status: TurnSocketStatus) => void
): ((status: TurnSocketStatus) => void) => watchConnectionWait((waiting) => mark(conversationId, waiting), onStatus)

export const useConnectionRestoring = (conversationId: string | undefined): boolean => {
  const unconnected = useSyncExternalStore(
    subscribe,
    () => conversationId !== undefined && restoring.has(conversationId),
    () => false
  )
  const waiting = useChatStore((state) => state.isStreaming || state.pendingInteraction != null)
  return unconnected && waiting
}
