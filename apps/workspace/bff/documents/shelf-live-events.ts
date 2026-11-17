import { z } from 'zod'

export type LiveShelf = { kind: 'project'; projectId: string } | { kind: 'office_shelf' }

const PROJECT_PREFIX = 'project-'
const PROJECT_ID = /^[A-Za-z0-9_-]{1,120}$/

export function shelfChannelKey(shelf: LiveShelf): string {
  return shelf.kind === 'office_shelf' ? 'shelf:office_shelf' : `shelf:${PROJECT_PREFIX}${shelf.projectId}`
}

export function parseShelfChannelId(id: string): LiveShelf | null {
  if (id === 'office_shelf' || id === 'archiv') return { kind: 'office_shelf' }
  if (!id.startsWith(PROJECT_PREFIX)) return null
  const projectId = id.slice(PROJECT_PREFIX.length)
  return PROJECT_ID.test(projectId) ? { kind: 'project', projectId } : null
}

export function shelfTopic(organizationId: string, shelf: LiveShelf): string {
  return shelf.kind === 'office_shelf'
    ? `rt:shelf:${organizationId}:office_shelf`
    : `rt:shelf:${organizationId}:project:${shelf.projectId}`
}

export const shelfEventSchema = z.object({
  kind: z.literal('shelf.changed'),
  folders: z.boolean(),
})
export type ShelfEvent = z.infer<typeof shelfEventSchema>
