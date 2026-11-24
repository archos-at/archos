import 'server-only'
import { isAgentKind } from '@/lib/agent-kind'
import { decisionAllowsPersonalShelf } from '@/lib/conversations/personal-shelf-use'
import { callDoorOf, type CallOrigin } from './call-origin'

export function ownShelfReadable(origin: CallOrigin): boolean {
  const door = callDoorOf(origin)
  if (door === 'mcp') return true
  const { principal } = origin
  if (door === 'a2a' || door === 'platform' || !isAgentKind(principal.actor)) return false
  return decisionAllowsPersonalShelf(principal.decision ?? null, {
    organizationId: principal.session.organizationId,
    conversationId: principal.conversationId ?? '',
    userId: principal.session.userId,
  })
}
