import 'server-only'
import { ForbiddenError, UnauthorizedError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { findConversationTenancy } from '@/lib/conversations/repository'
import { personalShelfCollectionName } from '@/lib/personal-shelf/collection'
import { findProjectCollectionName } from '@/lib/projects/repository'
import type { VerifiedRequestContext } from '@/lib/request-context'
import { resolveConversationContext } from './resolve'
import { decisionOf, signDecision, type ConversationDecision } from './wire'

export interface TurnDecisionResponse {
  decision: string
  signature: string
  body: ConversationDecision
}

export class DecisionLeavesItsSideError extends ForbiddenError {
  constructor() {
    super('This turn would draw on another side than its chat.')
    this.name = 'DecisionLeavesItsSideError'
  }
}

async function assertStaysOnItsSide(body: ConversationDecision): Promise<void> {
  if (!body.conversationId) return
  const row = await findConversationTenancy(body.conversationId)
  if (!row || row.organizationId !== body.organizationId) return
  const projectShelves = body.may.shelves.filter((entry) => entry.shelf === 'project').map((entry) => entry.collection)
  if (row.projectId === null) {
    const ownPersonalShelf = personalShelfCollectionName(body.organizationId, body.userId)
    const restricted = body.may.restrictedCollections.filter((collection) => collection !== ownPersonalShelf)
    if (projectShelves.length > 0 || restricted.length > 0) throw new DecisionLeavesItsSideError()
    return
  }
  const own = (await findProjectCollectionName(row.projectId, body.organizationId)) ?? `proj_${row.projectId}`
  const allowed = new Set([own, ...body.may.restrictedCollections])
  if (projectShelves.some((collection) => !allowed.has(collection))) throw new DecisionLeavesItsSideError()
}

export async function decideTurn(
  session: AuthorizedSession,
  envelope: Pick<VerifiedRequestContext, 'organizationId' | 'userId' | 'conversationId' | 'projectId' | 'contextKind'>,
  answerMessageId: string | null,
  now: number = Date.now(),
): Promise<TurnDecisionResponse> {
  const secret = process.env.INTERNAL_API_TOKEN
  if (!secret) throw new UnauthorizedError('No internal token is configured to sign the turn decision')
  const context = await resolveConversationContext(session, {
    conversationId: envelope.conversationId ?? undefined,
    projectId: envelope.projectId ?? undefined,
    kind: envelope.contextKind,
  })
  const body = decisionOf(context, envelope, answerMessageId, now)
  await assertStaysOnItsSide(body)
  const signed = signDecision(body, secret)
  return { decision: signed.header, signature: signed.signature, body }
}
