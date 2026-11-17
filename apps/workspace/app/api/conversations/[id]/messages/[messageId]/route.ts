import { z } from 'zod'
import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { updateMessageSchema } from '@/lib/conversations/conversation-wire'
import { updateMessageDetail } from '@/lib/conversations/service'

type Params = { id: string; messageId: string }

const messageIdSchema = z.guid()

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => {
    const messageId = messageIdSchema.safeParse(params.messageId)
    if (!messageId.success) throw new BadRequestError('Invalid message id')

    const body = await parseJsonBody(request, updateMessageSchema)
    return updateMessageDetail(session, params.id, messageId.data, {
      cardInteractions: body.cardInteractions,
      provenance: body.provenance,
      promptState: body.promptState,
      stages: body.stages,
    })
  },
  { authz: { enforcedBy: 'updateMessageDetail (requireResourceAccess)' } }
)
