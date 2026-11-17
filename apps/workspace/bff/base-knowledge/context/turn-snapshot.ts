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

export async function turnContextOf(organizationId: string, conversationId: string): Promise<TurnSnapshot | null> {
  return getCachedOrRefuse<TurnSnapshot | null>(
    keyOf(organizationId, conversationId),
    TURN_SNAPSHOT_TTL_MS,
    async () => null,
    (value) => value !== null,
  )
}
