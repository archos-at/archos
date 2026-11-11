/**
 * INTERNAL service endpoint — the agent's write path for personal memory
 * (ADR-0180): its `remember` tool with scope `personal`, and the reflection
 * stage. The owner is ALWAYS the person of the verified request envelope,
 * never a body field: the body is strict and has no place to name one. The
 * write runs as that person, so row-level security on `personal_memory` holds
 * it too. A temporary conversation keeps nothing and is refused. The body may
 * name the answer the note was saved under (`sourceMessageId`); the note is
 * stored with it and never on that message, which other people read.
 */

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
    // Today's membership, not the one the envelope was signed under: a person
    // who left the office since is refused before anything is kept for them.
    await requirePinnedSession(context)
    const owner = { organizationId: context.organizationId, userId: context.userId }
    // The conversation the body names, else the one the envelope was signed
    // for: leaving the field out must not be a way past the refusal.
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
      })
    })
  },
  {
    status: 201,
    tenancy: { fromPayload: 'verified X-Request-Context envelope, never the body' },
  },
)
