import { z } from 'zod'
import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { publishTypingPresence } from '@/lib/conversations/presence'

type Params = { id: string }

const typingSchema = z.object({
  typing: z.boolean().optional(),
})

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const input = await parseJsonBody(request, typingSchema)
    await publishTypingPresence(session, params.id, input.typing ?? true)
  },
  { authz: { enforcedBy: 'publishTypingPresence (requireResourceAccess, collaborator)' } }
)
