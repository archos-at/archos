/**
 * Organization-scoped memory — cross-cutting knowledge shared by every
 * project in the caller's organization. Tenancy comes from the session's
 * organization id; items are never visible across organizations. Any member
 * may read and write org memory (deliberately not admin-gated).
 *
 * Thin handlers; the write is `createOrganizationMemoryItem`
 * (`@/lib/projects/service`), the one an accepted memory proposal uses too.
 */

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
    // A topic's notes are filtered after the shelf is read, so the page is cut from them: the shelf is read whole.
    const fetched = await listOrganizationMemory(session.organizationId, {
      includeArchived: query.includeArchived === 'true',
      // The office's notes written from one conversation: the ids an answer's „noted“ chip may offer to take back.
      sourceConversationId: query.conversationId,
      page: query.topic === undefined ? page : undefined,
    })
    const listed =
      query.topic === undefined
        ? { items: fetched.slice(0, page.limit), nextCursor: nextOffsetCursor(page, fetched.length) }
        : pageOfTopic(fetched, query.topic, page)
    // `topics`: the office shelf's topics with how many active notes each holds, over the whole shelf, not this page.
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
