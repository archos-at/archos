import 'server-only'
import { UnauthorizedError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { VerifiedRequestContext } from '@/lib/request-context'
import { resolveConversationContext } from './resolve'
import { decisionOf, signDecision, type ConversationDecision } from './wire'

export interface TurnDecisionResponse {
  decision: string
  signature: string
  body: ConversationDecision
}

export async function decideTurn(
  session: AuthorizedSession,
  envelope: Pick<VerifiedRequestContext, 'organizationId' | 'userId' | 'conversationId' | 'projectId'>,
  answerMessageId: string | null,
  now: number = Date.now(),
): Promise<TurnDecisionResponse> {
  const secret = process.env.INTERNAL_API_TOKEN
  if (!secret) throw new UnauthorizedError('No internal token is configured to sign the turn decision')
  const context = await resolveConversationContext(session, {
    conversationId: envelope.conversationId ?? undefined,
    projectId: envelope.projectId ?? undefined,
    kind: 'chat',
  })
  const body = decisionOf(context, envelope, answerMessageId, now)
  const signed = signDecision(body, secret)
  return { decision: signed.header, signature: signed.signature, body }
}
