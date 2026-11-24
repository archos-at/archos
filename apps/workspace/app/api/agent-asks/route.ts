import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { CHAT_TURN_LIMIT } from '@/lib/limits/catalog'
import { createAskSchema, isTerminalAskState } from '@/lib/agent-asks/ask-wire'
import { askAgent } from '@/lib/agent-asks/service'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(
  async ({ session, request }) => {
    const ask = await askAgent(session, await parseJsonBody(request, createAskSchema))
    return Response.json(ask, { status: isTerminalAskState(ask.state) ? 200 : 202 })
  },
  {
    authz: {
      enforcedBy:
        'askAgent (the agent-requests flag; requireProjectAccess CHAT_PERMISSIONS on the project; a continued conversation must be one an ask of this person started)',
    },
    limits: { rule: CHAT_TURN_LIMIT },
  },
)
