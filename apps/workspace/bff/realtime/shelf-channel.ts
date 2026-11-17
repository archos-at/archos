import 'server-only'
import { requireShelfRead } from '@/lib/documents/shelf-authz'
import { parseShelfChannelId, shelfEventSchema, shelfTopic } from '@/lib/documents/shelf-live-events'
import { defineChannel } from './channel'

export const SHELF_REAUTHORIZE_MS = 30_000

export const shelfChannel = defineChannel({
  kind: 'shelf',
  parse: parseShelfChannelId,
  topics: (shelf, organizationId) => [shelfTopic(organizationId, shelf)],
  authorize: async (session, shelf) => {
    await requireShelfRead(session, shelf)
  },
  reauthorizeMs: SHELF_REAUTHORIZE_MS,
  events: shelfEventSchema,
})
