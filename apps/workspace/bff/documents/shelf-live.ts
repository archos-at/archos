import 'server-only'

import { publishProjectChanged } from '@/lib/realtime/door-events'
import { publish } from '@/lib/realtime/hub'
import { shelfEventSchema, shelfTopic, type LiveShelf } from './shelf-live-events'

export function publishShelfChanged(
  organizationId: string,
  shelf: LiveShelf | null,
  { folders = false }: { folders?: boolean } = {}
): void {
  if (!shelf) return
  if (shelf.kind === 'project') publishProjectChanged(organizationId, shelf.projectId)
  try {
    void publish(shelfTopic(organizationId, shelf), shelfEventSchema.parse({ kind: 'shelf.changed', folders })).catch(
      (error: unknown) => console.warn('[documents] could not announce a shelf change:', error)
    )
  } catch (error) {
    console.warn('[documents] could not announce a shelf change:', error)
  }
}
