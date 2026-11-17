import { createRetryLadder } from '@/shared/utils/backoff'
import type { CollaborationEvent } from '@/lib/events/types'

export type { CollaborationEvent }

type Listener = (event: CollaborationEvent) => void

const listeners = new Set<Listener>()

let source: EventSource | null = null
let connected = false
const connectionListeners = new Set<(connected: boolean) => void>()

const reconnect = createRetryLadder({ baseMs: 2_000, maxMs: 30_000 })

function setConnected(next: boolean): void {
  if (connected === next) return
  connected = next
  for (const listener of connectionListeners) {
    try {
      listener(next)
    } catch {
      // A listener throwing must not break the others.
    }
  }
}

function open(): void {
  if (source || typeof window === 'undefined') return

  source = new EventSource('/api/stream')

  source.onopen = () => {
    reconnect.reset()
    setConnected(true)
  }

  source.onmessage = (message) => {
    try {
      const parsed = JSON.parse(message.data) as { event?: CollaborationEvent }
      if (!parsed?.event?.kind) return
      for (const listener of listeners) {
        try {
          listener(parsed.event)
        } catch (error) {
          console.warn('[event-hub] listener threw:', error)
        }
      }
    } catch {
      // Ignore unparseable frames (heartbeat comments never reach onmessage).
    }
  }

  source.onerror = () => {
    setConnected(false)
    close()
    if (listeners.size === 0) return
    reconnect.schedule(open)
  }
}

function close(): void {
  reconnect.cancel()
  if (source) {
    source.close()
    source = null
  }
  setConnected(false)
}

export function subscribeToEvents(listener: Listener): () => void {
  listeners.add(listener)
  if (listeners.size === 1) open()
  return () => {
    listeners.delete(listener)
    if (listeners.size !== 0) return
    close()
    reconnect.reset()
  }
}

export function subscribeToConnection(listener: (connected: boolean) => void): () => void {
  connectionListeners.add(listener)
  listener(connected)
  return () => {
    connectionListeners.delete(listener)
  }
}

export function isConnected(): boolean {
  return connected
}

export function __resetEventHub(): void {
  listeners.clear()
  connectionListeners.clear()
  close()
  reconnect.reset()
}
