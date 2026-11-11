/**
 * INTERNAL service endpoint — the agent tier stores a post-answer stage's
 * frame on the answer it belongs to, so the frame outlives the browser that
 * would otherwise be its only writer (`post-answer-stages.md` §11 risk 3).
 * Memory reflection is the one stage that calls it: every note the turn saved
 * is shown under its answer, also after the person left the chat.
 *
 * `PATCH { stage: 'memory_reflection', payload }` → the message. Token-guarded
 * (`internalApiRoute`) and signed: the organization comes from the turn's
 * verified `X-Request-Context` envelope, never the body, and the envelope must
 * name this conversation. The payload passes the browser path's
 * `sanitizeStages` and the same per-stage merge, so the two writers converge.
 * 404 while the answer row does not exist yet; the caller retries.
 */

import { z } from 'zod'
import { BadRequestError } from '@/lib/api/errors'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { requireVerifiedContext } from '@/lib/api/internal-envelope'
import { internalStageFrameSchema, recordAgentStageFrame } from '@/lib/conversations/agent-stage-frame'
import { withTenant } from '@/lib/db/tenant-context'

type Params = { id: string; messageId: string }

/** `messages.id` is a uuid column — a malformed id must 400, not blow up in SQL. */
const messageIdSchema = z.guid()

export const PATCH = internalApiRoute<Params>(
  'Internal Message Stages',
  async ({ request, params }) => {
    const context = requireVerifiedContext(request)
    if (context.conversationId !== params.id) {
      throw new BadRequestError('The conversation does not match the request context envelope')
    }
    const messageId = messageIdSchema.safeParse(params.messageId)
    if (!messageId.success) throw new BadRequestError('Invalid message id')
    const frame = await parseJsonBody(request, internalStageFrameSchema)
    const { organizationId } = context
    return withTenant({ organizationId }, () => recordAgentStageFrame(organizationId, params.id, messageId.data, frame))
  },
  { tenancy: { fromPayload: 'verified X-Request-Context envelope, never the body' } }
)
