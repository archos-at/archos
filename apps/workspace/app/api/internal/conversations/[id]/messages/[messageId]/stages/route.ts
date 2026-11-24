import { z } from 'zod'
import { BadRequestError } from '@/lib/api/errors'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { requireVerifiedContext } from '@/lib/api/internal-envelope'
import { internalStageFrameSchema, recordAgentStageFrame } from '@/lib/conversations/agent-stage-frame'
import { withSystemReader } from '@/lib/db/tenant-context'

type Params = { id: string; messageId: string }

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
    return withSystemReader(organizationId, 'agent-host', () => recordAgentStageFrame(organizationId, params.id, messageId.data, frame))
  },
  { tenancy: { fromPayload: 'verified X-Request-Context envelope, never the body' } }
)
