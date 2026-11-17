import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'
import type { ServerEvent, ServerEventBus } from '@modelcontextprotocol/server'
import { DOOR_EVENTS_TOPIC, doorEventSchema } from '@/lib/realtime/door-events'
import { publish, subscribe } from '@/lib/realtime/hub'
import { canonicalUri } from '../legacy-names'

const listeningOrganization = new AsyncLocalStorage<string>()

export function listeningAs<T>(organizationId: string, work: () => T): T {
  return listeningOrganization.run(organizationId, work)
}

export class DoorEventBus implements ServerEventBus {
  publish(event: ServerEvent): void {
    const parsed = doorEventSchema.safeParse(event)
    if (!parsed.success) return
    void publish(DOOR_EVENTS_TOPIC, parsed.data)
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    const organizationId = listeningOrganization.getStore()
    if (!organizationId) return () => undefined
    return subscribe(DOOR_EVENTS_TOPIC, (payload) => {
      const parsed = doorEventSchema.safeParse(payload)
      if (!parsed.success || parsed.data.organizationId !== organizationId) return
      const event = parsed.data
      listener(event.kind === 'resource_updated' ? { kind: 'resource_updated', uri: canonicalUri(event.uri) } : { kind: 'resources_list_changed' })
    })
  }
}
