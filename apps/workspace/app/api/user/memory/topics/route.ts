import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { removePersonalMemoryTopic, renamePersonalMemoryTopic } from '@/lib/personal-memory/service'
import { deletePersonalMemoryTopicSchema, renamePersonalMemoryTopicSchema } from '@/lib/personal-memory/wire'

const WHY = 'the caller’s own notes, keyed to session.userId and held by row-level security on the person'

export const PATCH = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, renamePersonalMemoryTopicSchema)
    return renamePersonalMemoryTopic({ organizationId: session.organizationId, userId: session.userId }, input)
  },
  { authz: { sessionOnly: true, why: WHY } }
)

export const DELETE = apiRoute(
  async ({ session, request }) => {
    const { name } = await parseJsonBody(request, deletePersonalMemoryTopicSchema)
    return removePersonalMemoryTopic({ organizationId: session.organizationId, userId: session.userId }, name)
  },
  { authz: { sessionOnly: true, why: WHY } }
)
