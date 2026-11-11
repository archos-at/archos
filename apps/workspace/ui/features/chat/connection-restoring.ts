/**
 * Whether a conversation's socket has been unconnected for more than a moment.
 *
 * While the socket climbs its ladder, or its first dial after the page came
 * back hangs, a running answer stops moving and a note for the running turn
 * cannot be sent, and until the socket gave up the chat said nothing. The
 * thread's status dock reads this and says the connection is being restored,
 * in the line that says it is lost once the socket has given up.
 *
 * The socket lives in the composer's hook and the dock in the chat area, so
 * the fact is kept here, outside both, by conversation. It is not a message
 * in the thread: nothing is stored, and the line goes when the status moves on.
 */

import { useSyncExternalStore } from 'react'
import { CONNECTION_WAIT_NOTE_AFTER_MS, watchConnectionWait } from '@/adapters/api/connection-wait'
import type { TurnSocketStatus } from '@/adapters/api/turn-socket'
import { useChatStore } from './store'

/** How long the socket may be unconnected before the thread says so (`connection-wait.ts`). */
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

/**
 * `onStatus`, with the conversation's wait for a connection noted on the way
 * through. Which statuses count, and which end the wait: `connection-wait.ts`.
 */
export const watchRestoring = (
  conversationId: string,
  onStatus: (status: TurnSocketStatus) => void
): ((status: TurnSocketStatus) => void) => watchConnectionWait((waiting) => mark(conversationId, waiting), onStatus)

/**
 * Whether the thread should say that the connection is being restored: the
 * socket has been unconnected for more than a moment, and somebody waits on
 * it (a turn is running, or the agent's question is open). An idle thread
 * loses nothing while the socket connects, and is told nothing: a normal page
 * load stays quiet however long its first connect takes.
 */
export const useConnectionRestoring = (conversationId: string | undefined): boolean => {
  const unconnected = useSyncExternalStore(
    subscribe,
    () => conversationId !== undefined && restoring.has(conversationId),
    () => false
  )
  const waiting = useChatStore((state) => state.isStreaming || state.pendingInteraction != null)
  return unconnected && waiting
}
