/**
 * Project memory API — list and manually add memory items.
 * Thin handlers; authz and logic live in `@/lib/projects/service`.
 */

import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { offsetPageOf } from '@/lib/api/offset-page'
import { addProjectMemoryItem, getProjectMemoryPage, getProjectMemoryTopics } from '@/lib/projects/service'
import { canWriteProjectMemory } from '@/lib/projects/settings-access'
import { createMemorySchema, listMemoryQuerySchema, toMemoryWireItem } from '@/lib/projects/project-memory-wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const query = parseQuery(request, listMemoryQuerySchema)
    const { items, nextCursor } = await getProjectMemoryPage(session, params.id, {
      includeArchived: query.includeArchived === 'true',
      sourceConversationId: query.conversationId || undefined,
      page: offsetPageOf(query),
    })
    // `canWrite`: whether the caller may edit and remove these notes, so a
    // surface that lists them (the answer's noted chip) offers no action the
    // item route would refuse.
    const canWrite = await canWriteProjectMemory(session, params.id)
    // `topics`: the shelf's topics with how many notes each holds, over every note the caller sees, not this page.
    const topics = await getProjectMemoryTopics(session, params.id)
    return { items: items.map(toMemoryWireItem), nextCursor, canWrite, topics }
  },
  { authz: { enforcedBy: 'getProjectMemory (requireProjectAccess project:view)' } }
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
