import 'server-only'
import { UnauthorizedError } from '@/lib/api/errors'
import type { VerifiedRequestContext } from '@/lib/request-context'
import { readContextAudience } from './audience'
import { TURN_DECISION_HEADER, TURN_DECISION_SIGNATURE_HEADER, verifyDecision, type ConversationDecision } from './wire'
import { mayPersonalMemory, workspaceReadOf, type WorkspaceRead } from './types'

export { resolveConversationContext, type ContextRequest, type AudienceRead } from './resolve'
export type { ConversationContext, ContextKind } from './types'

export interface PromptFacts {
  solo: boolean
  personalMemory: boolean
  workspaceRead: WorkspaceRead
}

const CLOSED: PromptFacts = { solo: false, personalMemory: false, workspaceRead: 'none' }

export async function promptFacts(
  context: Pick<VerifiedRequestContext, 'organizationId' | 'userId' | 'conversationId'>,
  decision: ConversationDecision | null,
): Promise<PromptFacts> {
  const { organizationId, userId, conversationId } = context
  if (decision) {
    if (decision.conversationId !== conversationId) return CLOSED
    return { solo: decision.solo, personalMemory: decision.may.personalMemory, workspaceRead: decision.may.workspaceRead }
  }
  if (!conversationId) return { solo: false, personalMemory: false, workspaceRead: workspaceReadOf('chat', null, false) }
  try {
    const { solo } = await readContextAudience(organizationId, conversationId, userId)
    return { solo, personalMemory: mayPersonalMemory('chat', conversationId, solo), workspaceRead: workspaceReadOf('chat', conversationId, solo) }
  } catch (error) {
    console.warn('[Conversation Context] The audience could not be read; the turn is closed:', error)
    return CLOSED
  }
}

export function decisionFromRequest(request: Request): ConversationDecision | null {
  const header = request.headers.get(TURN_DECISION_HEADER)
  if (!header) return null
  const decision = verifyDecision(header, request.headers.get(TURN_DECISION_SIGNATURE_HEADER), process.env.INTERNAL_API_TOKEN)
  if (!decision) throw new UnauthorizedError('The turn decision is unsigned, stale or malformed')
  return decision
}
