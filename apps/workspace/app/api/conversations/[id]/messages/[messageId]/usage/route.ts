import { z } from 'zod'
import { apiRoute } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { getAnswerUsage } from '@/lib/budgets/service'

type Params = { id: string; messageId: string }

const messageIdSchema = z.guid()

export const GET = apiRoute<Params>(
  async ({ session, params }) => {
    const messageId = messageIdSchema.safeParse(params.messageId)
    if (!messageId.success) throw new BadRequestError('Invalid message id')
    return { usage: await getAnswerUsage(session, params.id, messageId.data) }
  },
  { authz: { enforcedBy: 'getAnswerUsage (requireResourceAccess)' } }
)
