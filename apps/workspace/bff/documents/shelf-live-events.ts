import { z } from 'zod'

export type LiveShelf =
  | { kind: 'project'; projectId: string }
  | { kind: 'office_shelf' }
  | { kind: 'personal'; userId: string }

const PROJECT_PREFIX = 'project-'
const PERSONAL_PREFIX = 'personal-'
const CHANNEL_ID = /^[A-Za-z0-9_-]{1,120}$/

export function shelfChannelKey(shelf: LiveShelf): string {
  switch (shelf.kind) {
    case 'office_shelf':
      return 'shelf:office_shelf'
    case 'project':
      return `shelf:${PROJECT_PREFIX}${shelf.projectId}`
    case 'personal':
      return `shelf:${PERSONAL_PREFIX}${shelf.userId}`
  }
}

export function parseShelfChannelId(id: string): LiveShelf | null {
  if (id === 'office_shelf' || id === 'archiv') return { kind: 'office_shelf' }
  if (id.startsWith(PROJECT_PREFIX)) {
    const projectId = id.slice(PROJECT_PREFIX.length)
    return CHANNEL_ID.test(projectId) ? { kind: 'project', projectId } : null
  }
  if (id.startsWith(PERSONAL_PREFIX)) {
    const userId = id.slice(PERSONAL_PREFIX.length)
    return CHANNEL_ID.test(userId) ? { kind: 'personal', userId } : null
  }
  return null
}

export function shelfTopic(organizationId: string, shelf: LiveShelf): string {
  switch (shelf.kind) {
    case 'office_shelf':
      return `rt:shelf:${organizationId}:office_shelf`
    case 'project':
      return `rt:shelf:${organizationId}:project:${shelf.projectId}`
    case 'personal':
      return `rt:shelf:${organizationId}:personal:${shelf.userId}`
  }
}

export const shelfEventSchema = z.object({
  kind: z.literal('shelf.changed'),
  folders: z.boolean(),
})
export type ShelfEvent = z.infer<typeof shelfEventSchema>
