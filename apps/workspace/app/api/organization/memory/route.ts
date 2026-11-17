import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { listOrganizationMemory } from '@/lib/projects/memory-service'
import { createOrganizationMemoryItem } from '@/lib/projects/service'
import { createOrgMemorySchema } from '@/lib/organizations/organization-wire'
import { offsetPageOf, nextOffsetCursor } from '@/lib/api/offset-page'
import { listOrganizationMemoryQuerySchema, toMemoryWireItem } from '@/lib/projects/project-memory-wire'
import { officeTopicsOf } from '@/lib/projects/office-memory-topics'
import { pageOfTopic } from '@/lib/memory-topics/page'

export const GET = apiRoute(
  async ({ session, request }) => {
    const query = parseQuery(request, listOrganizationMemoryQuerySchema)
    const page = offsetPageOf(query)
    const fetched = await listOrganizationMemory(session.organizationId, {
      includeArchived: query.includeArchived === 'true',
      sourceConversationId: query.conversationId,
      page: query.topic === undefined ? page : undefined,
    })
    const listed =
      query.topic === undefined
        ? { items: fetched.slice(0, page.limit), nextCursor: nextOffsetCursor(page, fetched.length) }
        : pageOfTopic(fetched, query.topic, page)
    const topics = await officeTopicsOf(session.organizationId)
    return {
      items: listed.items.map(toMemoryWireItem),
      nextCursor: listed.nextCursor,
      topics,
    }
  },
  {
    authz: {
      sessionOnly: true,
      why: 'org-wide memory is shared by every project in the tenant and scoped by session.organizationId; deliberately not admin-gated',
    },
  }
)

export const POST = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, createOrgMemorySchema)
    const item = await createOrganizationMemoryItem(session, input)
    return { item: toMemoryWireItem(item) }
  },
  {
    status: 201,
    authz: {
      sessionOnly: true,
      why: 'org-wide memory is shared by every project in the tenant and scoped by session.organizationId; deliberately not admin-gated',
    },
  }
)
