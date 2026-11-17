import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { createMessagesSchema, listMessagesQuerySchema } from '@/lib/conversations/conversation-wire'
import { messagesForAgent } from '@/lib/conversations/messages-for-agent'
import { createConversationMessages, listConversationMessages } from '@/lib/conversations/service'
import {
  DEFAULT_MUTATION_LIMIT,
  enforceLimit,
  memberSubject,
} from '@/lib/limits'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const page = await listConversationMessages(session, params.id, parseQuery(request, listMessagesQuerySchema))
    return actingReaderIsAgent() ? messagesForAgent(page, params.id, session.organizationId) : page
  },
  { authz: { enforcedBy: 'listConversationMessages (requireResourceAccess)' } }
)

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const body = await parseJsonBody(request, createMessagesSchema)
    const inputs = Array.isArray(body) ? body : [body]
    if (inputs.length > 1) {
      await enforceLimit(DEFAULT_MUTATION_LIMIT, memberSubject(session), inputs.length - 1)
    }
    return createConversationMessages(session, params.id, inputs)
  },
  { status: 201, authz: { enforcedBy: 'createConversationMessages (requireResourceAccess)' } }
)
