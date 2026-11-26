import { z } from 'zod'
import { BadRequestError } from '@/lib/api/errors'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { withSystemReader } from '@/lib/db/tenant-context'
import { ADMISSION_MAX_COLLECTIONS, admitRestrictedUse } from '@/lib/conversations/restricted-use'
import { admitPersonalShelf, splitPersonalShelf } from '@/lib/conversations/personal-shelf-use'
import { decisionFromRequest } from '@/lib/conversation-context'

type Params = { id: string }


const restrictedUseSchema = z.object({
  organizationId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128).nullish(),
  admit: z.array(z.string().min(1).max(200)).min(1).max(ADMISSION_MAX_COLLECTIONS),
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
    const decision = decisionFromRequest(request)
    const { personal, others } = splitPersonalShelf(body.admit)
    return withSystemReader(body.organizationId, 'agent-host', async () => {
      const [folders, ownShelf] = await Promise.all([
        others.length > 0 ? admitRestrictedUse(useRequest, others) : Promise.resolve({ admitted: [], refused: [], recorded: [] }),
        personal.length > 0 ? admitPersonalShelf(useRequest, personal, decision) : Promise.resolve([]),
      ])
      return {
        admitted: [...folders.admitted, ...ownShelf],
        refused: [...folders.refused, ...personal.filter((collection) => !ownShelf.includes(collection))],
        recorded: folders.recorded,
      }
    })
  },
  { tenancy: { fromPayload: 'body.organizationId' } }
)
