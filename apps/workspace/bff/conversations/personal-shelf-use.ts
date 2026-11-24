import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { conversations } from '@/lib/db/schema/conversations'
import { recordAnswerReads } from '@/lib/conversation-context/record'
import { isSoloAudience } from '@/lib/conversation-context/types'
import type { ConversationDecision } from '@/lib/conversation-context/wire'
import { isPersonalShelfCollectionName, personalShelfCollectionName } from '@/lib/personal-shelf/collection'
import { lockConversationAudience, readConversationAudience } from './restricted-use-repository'

export interface PersonalShelfUseRequest {
  organizationId: string
  conversationId: string
  userId: string
  answerMessageId?: string | null
}

export function splitPersonalShelf(collections: readonly string[]): { personal: string[]; others: string[] } {
  return {
    personal: collections.filter(isPersonalShelfCollectionName),
    others: collections.filter((collection) => !isPersonalShelfCollectionName(collection)),
  }
}

export function decisionAllowsPersonalShelf(decision: ConversationDecision | null, request: PersonalShelfUseRequest): boolean {
  return (
    decision !== null &&
    decision.kind === 'chat' &&
    decision.may.personalShelf &&
    decision.organizationId === request.organizationId &&
    decision.userId === request.userId &&
    decision.conversationId === request.conversationId
  )
}

export async function admitPersonalShelf(
  request: PersonalShelfUseRequest,
  collections: readonly string[],
  decision: ConversationDecision | null,
): Promise<string[]> {
  const own = personalShelfCollectionName(request.organizationId, request.userId)
  if (!collections.includes(own) || !decisionAllowsPersonalShelf(decision, request)) return []
  const { organizationId, conversationId } = request
  const admitted = await getDb().transaction(async (tx) => {
    await lockConversationAudience(tx, organizationId, conversationId)
    const audience = await readConversationAudience(tx, organizationId, conversationId)
    if (!audience.exists || audience.subject || audience.projectId !== null || !isSoloAudience(audience, request.userId)) return false
    await markPersonalShelfUse(tx, organizationId, conversationId)
    if (request.answerMessageId) {
      await recordAnswerReads(tx, organizationId, conversationId, request.answerMessageId, { personalShelf: true })
    }
    return true
  })
  return admitted ? [own] : []
}

async function markPersonalShelfUse(executor: DbExecutor, organizationId: string, conversationId: string): Promise<void> {
  await executor
    .update(conversations)
    .set({ personalShelfUsedAt: sql`now()` })
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(conversations.id, conversationId),
        isNull(conversations.personalShelfUsedAt),
      ),
    )
}

export async function personalShelfUseOf(
  organizationId: string,
  conversationId: string,
): Promise<{ ownerId: string } | null> {
  const [row] = await getDb()
    .select({ usedAt: conversations.personalShelfUsedAt, createdBy: conversations.createdBy })
    .from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.id, conversationId)))
    .limit(1)
  return row?.usedAt ? { ownerId: row.createdBy } : null
}

export async function personalShelfUsed(organizationId: string, conversationId: string, executor: DbExecutor = getDb()): Promise<boolean> {
  const [row] = await executor
    .select({ usedAt: conversations.personalShelfUsedAt })
    .from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.id, conversationId)))
    .limit(1)
  return Boolean(row?.usedAt)
}
