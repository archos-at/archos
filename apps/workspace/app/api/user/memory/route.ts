/**
 * Personal memory (ADR-0180): what the agent keeps about the caller, read by
 * the caller and nobody else. Thin handlers; the logic is in
 * `@/lib/personal-memory/service`.
 */

import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { offsetPageOf } from '@/lib/api/offset-page'
import { createPersonalMemoryItem, listPersonalMemory } from '@/lib/personal-memory/service'
import { createPersonalMemorySchema, listPersonalMemoryQuerySchema } from '@/lib/personal-memory/wire'

/** Stated on each handler: `authz-coverage.spec.ts` reads every export on its own. */
const WHY = 'the caller’s own notes, keyed to session.userId and held by row-level security on the person'

export const GET = apiRoute(
  async ({ session, request }) =>
    listPersonalMemory(
      { organizationId: session.organizationId, userId: session.userId },
      offsetPageOf(parseQuery(request, listPersonalMemoryQuerySchema))
    ),
  { authz: { sessionOnly: true, why: WHY } }
)

export const POST = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, createPersonalMemorySchema)
    const { item } = await createPersonalMemoryItem(
      { organizationId: session.organizationId, userId: session.userId },
      { ...input, provenanceType: 'user' }
    )
    return { item }
  },
  { status: 201, authz: { sessionOnly: true, why: WHY } }
)
