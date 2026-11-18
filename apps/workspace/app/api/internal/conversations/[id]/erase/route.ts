import { z } from 'zod'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import { retryConversationErasure } from '@/lib/conversations/service'

type Params = { id: string }

const eraseSchema = z.object({
  organizationId: z.string().min(1).max(128),
})

export const POST = internalApiRoute<Params>(
  'Internal Conversation Erase',
  async ({ request, params }) => {
    const { organizationId } = await parseJsonBody(request, eraseSchema)
    return withTenant({ organizationId }, () => retryConversationErasure(organizationId, params.id))
  },
  { tenancy: { fromPayload: 'body.organizationId' } }
)
