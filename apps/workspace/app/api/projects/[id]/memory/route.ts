import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { offsetPageOf } from '@/lib/api/offset-page'
import { addProjectMemoryItem, getProjectMemoryShelf } from '@/lib/projects/service'
import { canWriteProjectMemory } from '@/lib/projects/settings-access'
import { createMemorySchema, listMemoryQuerySchema, toMemoryWireItem } from '@/lib/projects/project-memory-wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const query = parseQuery(request, listMemoryQuerySchema)
    const { items, nextCursor, topics } = await getProjectMemoryShelf(session, params.id, {
      includeArchived: query.includeArchived === 'true',
      sourceConversationId: query.conversationId || undefined,
      page: offsetPageOf(query),
      topic: query.topic,
    })
    const canWrite = await canWriteProjectMemory(session, params.id)
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
