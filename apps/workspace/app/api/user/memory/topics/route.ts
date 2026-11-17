/**
 * The caller's personal memory topics (ADR-0180): rename or merge a topic
 * (PATCH) and remove every note on one (DELETE). Only the caller's notes are
 * touched: the service reads and writes as the caller, and row-level security
 * holds the same line. Thin handlers; the logic is in `@/lib/personal-memory/service`.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { removePersonalMemoryTopic, renamePersonalMemoryTopic } from '@/lib/personal-memory/service'
import { deletePersonalMemoryTopicSchema, renamePersonalMemoryTopicSchema } from '@/lib/personal-memory/wire'

/** Stated on each handler: `authz-coverage.spec.ts` reads every export on its own. */
const WHY = 'the caller’s own notes, keyed to session.userId and held by row-level security on the person'

/** Every note of the caller on `from` moves to `to`; a `to` another topic has merges. Answers `{ moved }`. */
export const PATCH = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, renamePersonalMemoryTopicSchema)
    return renamePersonalMemoryTopic({ organizationId: session.organizationId, userId: session.userId }, input)
  },
  { authz: { sessionOnly: true, why: WHY } }
)

/** Removes every note of the caller on the topic, for good. Answers `{ removed }`. */
export const DELETE = apiRoute(
  async ({ session, request }) => {
    const { name } = await parseJsonBody(request, deletePersonalMemoryTopicSchema)
    return removePersonalMemoryTopic({ organizationId: session.organizationId, userId: session.userId }, name)
  },
  { authz: { sessionOnly: true, why: WHY } }
)
