/**
 * INTERNAL service endpoint: the agent tier stores a finished turn's
 * Herleitung on its question, so the steps outlive the browser that would
 * otherwise be their only writer (a turn asked through the agent door, a wake,
 * a browser closed mid-turn).
 *
 * `PUT { organizationId, frames }` → `{ stored }`, the rows kept. The message
 * id is the turn's id, which is its question's. Token-guarded
 * (`internalApiRoute`) and scoped like the answer row the same writer posts just
 * before (`../../route.ts`): the conversation is resolved in the body's
 * organization, under that tenant. The frames are folded by the browser's fold
 * and bounded by the browser path's sanitizer (`bff/turns/turn-steps.ts`).
 */

import { z } from 'zod'
import { BadRequestError } from '@/lib/api/errors'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import { internalTurnStepsSchema, recordTurnSteps } from '@/lib/turns/turn-steps'

type Params = { id: string; messageId: string }

/** `messages.id` is a uuid column — a malformed id must 400, not blow up in SQL. */
const messageIdSchema = z.guid()

export const PUT = internalApiRoute<Params>(
  'Internal Turn Steps',
  async ({ request, params }) => {
    const messageId = messageIdSchema.safeParse(params.messageId)
    if (!messageId.success) throw new BadRequestError('Invalid message id')
    const { organizationId, frames } = await parseJsonBody(request, internalTurnStepsSchema)
    return withTenant({ organizationId }, () => recordTurnSteps(organizationId, params.id, messageId.data, frames))
  },
  { tenancy: { fromPayload: 'body.organizationId' } }
)
