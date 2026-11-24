import 'server-only'
import { UnauthorizedError } from '@/lib/api/errors'
import type { VerifiedRequestContext } from '@/lib/request-context'
import { readContextAudience } from './audience'
import { TURN_DECISION_HEADER, TURN_DECISION_SIGNATURE_HEADER, verifyDecision, type ConversationDecision } from './wire'
import { mayPersonalMemory, workspaceReadOf, type WorkspaceRead } from './types'

export {
  resolveConversationContext,
  resolveConversationScope,
  type ContextRequest,
  type AudienceRead,
  type ConversationScope,
} from './resolve'
export type { ConversationContext, ContextKind } from './types'

export interface PromptFacts {
  solo: boolean
  personalMemory: boolean
  workspaceRead: WorkspaceRead
  closed: boolean
}

const CLOSED: PromptFacts = { solo: false, personalMemory: false, workspaceRead: 'none', closed: true }

export async function promptFacts(
  context: Pick<VerifiedRequestContext, 'organizationId' | 'userId' | 'conversationId'> &
    Partial<Pick<VerifiedRequestContext, 'contextKind'>>,
  decision: ConversationDecision | null,
): Promise<PromptFacts> {
  const { organizationId, userId, conversationId } = context
  const kind = context.contextKind ?? 'chat'
  const foreign = decision && (decision.userId !== userId || decision.organizationId !== organizationId)
  if (decision && (foreign || decision.conversationId !== conversationId || decision.kind !== kind)) return CLOSED
  if (!conversationId) return { solo: false, personalMemory: false, workspaceRead: workspaceReadOf(kind, null, false), closed: false }
  try {
    const { solo: now } = await readContextAudience(organizationId, conversationId, userId)
    const solo = now && (decision?.solo ?? true)
    return {
      solo,
      personalMemory: mayPersonalMemory(kind, conversationId, solo) && (decision?.may.personalMemory ?? true),
      workspaceRead: narrower(workspaceReadOf(kind, conversationId, solo), decision?.may.workspaceRead),
      closed: false,
    }
  } catch (error) {
    console.warn('[Conversation Context] The audience could not be read; the turn is closed:', error)
    return CLOSED
  }
}

const WORKSPACE_ORDER: readonly WorkspaceRead[] = ['none', 'document+projectFacts', 'all']

function narrower(now: WorkspaceRead, decided: WorkspaceRead | undefined): WorkspaceRead {
  if (!decided) return now
  return WORKSPACE_ORDER[Math.min(WORKSPACE_ORDER.indexOf(now), WORKSPACE_ORDER.indexOf(decided))] ?? 'none'
}

export function decisionFromRequest(request: Request): ConversationDecision | null {
  const header = request.headers.get(TURN_DECISION_HEADER)
  if (!header) return null
  const decision = verifyDecision(header, request.headers.get(TURN_DECISION_SIGNATURE_HEADER), process.env.INTERNAL_API_TOKEN)
  if (!decision) throw new UnauthorizedError('The turn decision is unsigned, stale or malformed')
  return decision
}
