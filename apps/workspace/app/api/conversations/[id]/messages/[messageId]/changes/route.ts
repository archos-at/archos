import { z } from 'zod'
import { BadRequestError } from '@/lib/api/errors'
import { apiRoute } from '@/lib/api/handler'
import { listTurnChanges } from '@/lib/changes/service'
import type { TurnChangesResponse } from '@/lib/changes/types'

type Params = { id: string; messageId: string }

const messageIdSchema = z.guid()

export const GET = apiRoute<Params>(
  async ({ session, params }): Promise<TurnChangesResponse> => {
    const messageId = messageIdSchema.safeParse(params.messageId)
    if (!messageId.success) throw new BadRequestError('Invalid message id')
    return { changes: await listTurnChanges(session, params.id, messageId.data) }
  },
  {
    authz: {
      enforcedBy:
        "listTurnChanges (requireResourceAccess viewer on the conversation + each change's document through listAnnotations' read gate)",
    },
  }
)
