import { z } from 'zod'
import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { cutStoppedAnswerSchema } from '@/lib/conversations/conversation-wire'
import { cutStoppedAnswer } from '@/lib/conversations/service'

type Params = { id: string; messageId: string }

const messageIdSchema = z.guid()

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const messageId = messageIdSchema.safeParse(params.messageId)
    if (!messageId.success) throw new BadRequestError('Invalid message id')

    const body = await parseJsonBody(request, cutStoppedAnswerSchema)
    return cutStoppedAnswer(session, params.id, messageId.data, body)
  },
  { authz: { enforcedBy: 'cutStoppedAnswer (requireResourceAccess, asker of the turn)' } }
)
