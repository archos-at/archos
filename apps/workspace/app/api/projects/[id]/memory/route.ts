/**
 * Project memory API — list and manually add memory items.
 * Thin handlers; authz and logic live in `@/lib/projects/service`.
 */

import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { offsetPageOf } from '@/lib/api/offset-page'
import { addProjectMemoryItem, getProjectMemoryShelf } from '@/lib/projects/service'
import { canWriteProjectMemory } from '@/lib/projects/settings-access'
import { createMemorySchema, listMemoryQuerySchema, toMemoryWireItem } from '@/lib/projects/project-memory-wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const query = parseQuery(request, listMemoryQuerySchema)
    // One access check and one clearance answer the page and the topics; `topic` filters after visibility.
    const { items, nextCursor, topics } = await getProjectMemoryShelf(session, params.id, {
      includeArchived: query.includeArchived === 'true',
      sourceConversationId: query.conversationId || undefined,
      page: offsetPageOf(query),
      topic: query.topic,
    })
    // `canWrite`: whether the caller may edit and remove these notes, so a
    // surface that lists them (the answer's noted chip) offers no action the
    // item route would refuse.
    const canWrite = await canWriteProjectMemory(session, params.id)
    // `topics`: the shelf's topics with how many notes each holds, over every note the caller sees, not this page.
    return { items: items.map(toMemoryWireItem), nextCursor, canWrite, topics }
  },
  { authz: { enforcedBy: 'getProjectMemoryShelf (requireProjectAccess project:view)' } }
)

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const input = await parseJsonBody(request, createMemorySchema)
    return { item: toMemoryWireItem(await addProjectMemoryItem(session, params.id, input)) }
  },
  {
    status: 201,
    authz: { enforcedBy: 'addProjectMemoryItem (requireProjectAccess project:memory:write)' },
  }
)
