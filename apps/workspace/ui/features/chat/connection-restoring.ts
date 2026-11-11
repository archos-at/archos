/**
 * Whether a conversation's socket has been reconnecting for more than a moment.
 *
 * While the socket climbs its ladder a running answer stops moving and a note
 * for the running turn cannot be sent, and until the ladder was spent (up to
 * twelve rungs) the chat said nothing. The thread's status dock reads this
 * and says the connection is being restored, in the line that says it is lost
 * once the socket has given up.
 *
 * The socket lives in the composer's hook and the dock in the chat area, so
 * the fact is kept here, outside both, by conversation. It is not a message
 * in the thread: nothing is stored, and the line goes when the status moves on.
 */

import { useSyncExternalStore } from 'react'
import type { TurnSocketStatus } from '@/adapters/api/turn-socket'
import { useChatStore } from './store'

/**
 * How long the socket may be reconnecting before the thread says so. The
 * ladder's first rung is a second: a drop that the first attempt mends (a pod
 * replaced, a proxy that reset) is over before anyone could read a line.
 */
export const RESTORING_NOTE_AFTER_MS = 2_000

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
 * `onStatus`, with the conversation's reconnecting noted on the way through.
 *
 * `connecting` is one attempt of the ladder and changes nothing: the wait
 * runs across the attempts. Every other status ends it. `suspended` is a
 * hidden tab nobody reads, `offline` and `failed` have the connection-lost
 * line, and `open` is the connection restored.
 */
export const watchRestoring = (
  conversationId: string,
  onStatus: (status: TurnSocketStatus) => void
): ((status: TurnSocketStatus) => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (status) => {
    if (status === 'reconnecting') {
      timer ??= setTimeout(() => mark(conversationId, true), RESTORING_NOTE_AFTER_MS)
    } else if (status !== 'connecting') {
      if (timer) clearTimeout(timer)
      timer = null
      mark(conversationId, false)
    }
    onStatus(status)
  }
}

/**
 * Whether the thread should say that the connection is being restored: the
 * socket has been reconnecting for more than a moment, and somebody waits on
 * it (a turn is running, or the agent's question is open). An idle thread
 * loses nothing while the socket reconnects, and is told nothing.
 */
export const useConnectionRestoring = (conversationId: string | undefined): boolean => {
  const reconnecting = useSyncExternalStore(
    subscribe,
    () => conversationId !== undefined && restoring.has(conversationId),
    () => false
  )
  const waiting = useChatStore((state) => state.isStreaming || state.pendingInteraction != null)
  return reconnecting && waiting
}
