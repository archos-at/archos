/**
 * INTERNAL service endpoint — the agent's undo for personal memory (ADR-0180):
 * its `remember` tool with scope `personal` and `supersedes`, when the person
 * asks it to drop or correct a note. The body quotes the note as the agent's
 * `PERSONAL_MEMORY` block showed it; the owner is ALWAYS the person of the
 * verified request envelope, and the delete runs as that person, so row-level
 * security on `personal_memory` holds it too. Answers 200 `{ removedId,
 * refused }`: `not_found` when no note of theirs says that, `curated` when the
 * note is one they wrote or pinned (theirs to remove in the panel).
 */

import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { requirePinnedSession, requireVerifiedContext } from '@/lib/api/internal-envelope'
import { withTenant } from '@/lib/db/tenant-context'
import { forgetPersonalMemoryItem } from '@/lib/personal-memory/service'
import { internalForgetPersonalMemorySchema } from '@/lib/personal-memory/wire'

export const POST = internalApiRoute(
  'Internal Personal Memory Forget',
  async ({ request }) => {
    const context = requireVerifiedContext(request)
    const input = await parseJsonBody(request, internalForgetPersonalMemorySchema)
    await requirePinnedSession(context)
    const owner = { organizationId: context.organizationId, userId: context.userId }
    return withTenant(owner, () => forgetPersonalMemoryItem(owner, input.content))
  },
  {
    tenancy: { fromPayload: 'verified X-Request-Context envelope, never the body' },
  },
)
