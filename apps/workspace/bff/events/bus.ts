import 'server-only'
import * as hub from '@/lib/realtime/hub'
import type { CollaborationEvent, EventEnvelope } from './types'

export function userChannel(userId: string): string {
  return `user:${userId}:events`
}

export type { CollaborationEvent, EventEnvelope } from './types'

export interface EventTransport {
  publish(channel: string, payload: string): Promise<void>
  subscribe(channel: string, onMessage: (payload: string) => void): Promise<() => Promise<void>>
}

let counter = 0

function envelope(event: CollaborationEvent): EventEnvelope {
  counter += 1
  return { id: `${Date.now().toString(36)}-${counter}`, at: new Date().toISOString(), event }
}

export async function publishToUser(userId: string, event: CollaborationEvent): Promise<void> {
  void hub.publish(userChannel(userId), envelope(event))
}

export async function publishToUsers(userIds: readonly string[], event: CollaborationEvent): Promise<void> {
  const unique = [...new Set(userIds)].filter(Boolean)
  await Promise.all(unique.map((userId) => publishToUser(userId, event)))
}

export async function subscribeUser(
  userId: string,
  onEvent: (envelope: EventEnvelope) => void,
): Promise<() => Promise<void>> {
  const release = hub.subscribe(userChannel(userId), (payload) => {
    if (!payload || typeof payload !== 'object') {
      console.warn('[events] dropping malformed envelope')
      return
    }
    onEvent(payload as EventEnvelope)
  })
  return async () => release()
}
