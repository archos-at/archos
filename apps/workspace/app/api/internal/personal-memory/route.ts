import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { requirePinnedSession, requireVerifiedContext } from '@/lib/api/internal-envelope'
import { requireConversationKeepsMemory } from '@/lib/conversations/temporary'
import { withTenant } from '@/lib/db/tenant-context'
import { createPersonalMemoryItem } from '@/lib/personal-memory/service'
import { internalPersonalMemorySchema } from '@/lib/personal-memory/wire'

export const POST = internalApiRoute(
  'Internal Personal Memory',
  async ({ request }) => {
    const context = requireVerifiedContext(request)
    const input = await parseJsonBody(request, internalPersonalMemorySchema)
    await requirePinnedSession(context)
    const owner = { organizationId: context.organizationId, userId: context.userId }
    const sourceConversationId = input.sourceConversationId ?? context.conversationId ?? null
    return withTenant(owner, async () => {
      await requireConversationKeepsMemory(context.conversationId, context.organizationId)
      await requireConversationKeepsMemory(input.sourceConversationId, context.organizationId)
      return createPersonalMemoryItem(owner, {
        kind: input.kind,
        content: input.content,
        provenanceType: input.provenanceType,
        sourceConversationId,
        sourceMessageId: input.sourceMessageId ?? null,
        ...(input.topic === undefined ? {} : { topic: input.topic }),
      })
    })
  },
  {
    status: 201,
    tenancy: { fromPayload: 'verified X-Request-Context envelope, never the body' },
  },
)
