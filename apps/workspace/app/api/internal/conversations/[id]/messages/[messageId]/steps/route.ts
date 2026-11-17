import { z } from 'zod'
import { BadRequestError } from '@/lib/api/errors'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import { internalTurnStepsSchema, recordTurnSteps } from '@/lib/turns/turn-steps'

type Params = { id: string; messageId: string }

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
