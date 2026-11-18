import { z } from 'zod'
import { BadRequestError } from '@/lib/api/errors'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import {
  ADMISSION_MAX_COLLECTIONS,
  admitRestrictedUse,
  drawableRestrictedCollections,
  markTurnAnswer,
  recordedRestrictedFolders,
} from '@/lib/conversations/restricted-use'

type Params = { id: string }

const collectionList = z.array(z.string().min(1).max(200)).max(ADMISSION_MAX_COLLECTIONS).default([])

const restrictedUseSchema = z.object({
  organizationId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128).nullish(),
  candidates: collectionList,
  admit: collectionList,
  answerMessageId: z.guid().nullish(),
})

const CONVERSATION_ID_MAX_LENGTH = 128

export const POST = internalApiRoute<Params>(
  'Internal Conversation Restricted Use',
  async ({ request, params }) => {
    const body = await parseJsonBody(request, restrictedUseSchema)
    if (params.id.length > CONVERSATION_ID_MAX_LENGTH) throw new BadRequestError('Conversation id too long')
    const useRequest = {
      organizationId: body.organizationId,
      conversationId: params.id,
      userId: body.userId,
      projectId: body.projectId ?? null,
      answerMessageId: body.answerMessageId ?? null,
    }
    return withTenant({ organizationId: body.organizationId }, async () => {
      const drawable = await drawableRestrictedCollections(useRequest, body.candidates)
      if (body.admit.length === 0) {
        await markTurnAnswer(useRequest)
        return {
          drawable,
          admitted: [],
          refused: [],
          recorded: await recordedRestrictedFolders(params.id, body.organizationId),
        }
      }
      return { drawable, ...(await admitRestrictedUse(useRequest, body.admit)) }
    })
  },
  { tenancy: { fromPayload: 'body.organizationId' } }
)
