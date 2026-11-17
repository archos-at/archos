import 'server-only'

import { z } from 'zod'
import { publish } from '@/lib/realtime/hub'

export const DOOR_EVENTS_TOPIC = 'rt:door:events'

export const PROJECT_URI_PREFIX = 'workspace://project/'

export const projectResourceUri = (projectId: string): string => `${PROJECT_URI_PREFIX}${projectId}`

const organizationId = z.string().min(1)

export const doorEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('resource_updated'), organizationId, uri: z.string().min(1) }),
  z.object({ kind: z.literal('resources_list_changed'), organizationId }),
])
export type DoorEvent = z.infer<typeof doorEventSchema>

function announce(event: DoorEvent): void {
  try {
    void publish(DOOR_EVENTS_TOPIC, event).catch((error: unknown) => console.warn('[mcp] could not announce a change:', error))
  } catch (error) {
    console.warn('[mcp] could not announce a change:', error)
  }
}

export function publishProjectChanged(orgId: string, projectId: string): void {
  announce({ kind: 'resource_updated', organizationId: orgId, uri: projectResourceUri(projectId) })
}

export function publishProjectListChanged(orgId: string): void {
  announce({ kind: 'resources_list_changed', organizationId: orgId })
}
