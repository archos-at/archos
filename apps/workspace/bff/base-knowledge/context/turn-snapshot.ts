/**
 * The knowledge context a turn was answered on (E42, ADR-0173): kept when the
 * turn loads it, read when its answer is persisted. The answer then records
 * the editions and pack sequences it was really resolved at, even when a
 * release lands between the two, and the next turn can say the base moved.
 * One per conversation (its turns run one after another), for six hours.
 */

import 'server-only'
import { getCachedOrRefuse, setCached } from '@/lib/cache'
import type { KnowledgeContext } from './wire'

export const TURN_SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000

export type TurnSnapshot = Pick<KnowledgeContext, 'packs' | 'uses'>

const keyOf = (organizationId: string, conversationId: string) => `knowledge-context-turn:${organizationId}:${conversationId}`

export async function rememberTurnContext(organizationId: string, conversationId: string, context: KnowledgeContext): Promise<void> {
  const snapshot: TurnSnapshot = { packs: context.packs, uses: context.uses }
  await setCached(keyOf(organizationId, conversationId), snapshot, TURN_SNAPSHOT_TTL_MS)
}

/** The context the conversation's latest turn was answered on; null when none was kept (or it expired). */
export async function turnContextOf(organizationId: string, conversationId: string): Promise<TurnSnapshot | null> {
  return getCachedOrRefuse<TurnSnapshot | null>(
    keyOf(organizationId, conversationId),
    TURN_SNAPSHOT_TTL_MS,
    async () => null,
    (value) => value !== null,
  )
}
