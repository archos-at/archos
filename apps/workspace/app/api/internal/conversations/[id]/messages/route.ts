import { z } from 'zod'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import { persistInternalConversationMessages } from '@/lib/conversations/service'

type Params = { id: string }

const internalMessageSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1).max(128),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  messageType: z.string().min(1).max(64).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
})

export const POST = internalApiRoute<Params>(
  'Internal Conversation Messages',
  async ({ request, params }) => {
    const { organizationId, ...message } = await parseJsonBody(request, internalMessageSchema)
    const messages = await withTenant({ organizationId }, () =>
      persistInternalConversationMessages(organizationId, params.id, [message])
    )
    return { messages }
  },
  { status: 201, tenancy: { fromPayload: 'body.organizationId' } }
)
