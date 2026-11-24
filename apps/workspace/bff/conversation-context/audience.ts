import 'server-only'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { readConversationAudience, type ConversationAudienceRow } from '@/lib/conversations/restricted-use-repository'
import { isSoloAudience, type ContextAudience } from './types'
import type { ConversationDecision } from './wire'

export function audienceOf(row: ConversationAudienceRow, userId: string): ContextAudience {
  return { row, solo: isSoloAudience(row, userId), version: row.version }
}

export async function readConversationRow(
  organizationId: string,
  conversationId: string,
  executor: DbExecutor = getDb(),
): Promise<ConversationAudienceRow> {
  return readConversationAudience(executor, organizationId, conversationId)
}

export async function readContextAudience(
  organizationId: string,
  conversationId: string,
  userId: string,
  executor: DbExecutor = getDb(),
): Promise<ContextAudience> {
  return audienceOf(await readConversationRow(organizationId, conversationId, executor), userId)
}

export function decidedUnder(decided: number | null, now: ContextAudience): boolean {
  if (decided === null) return now.version === null || now.solo
  return now.version === decided
}

export function narrowedByDecision(
  now: ContextAudience,
  decision: Pick<ConversationDecision, 'conversationId' | 'solo'> | null | undefined,
  conversationId: string,
): ContextAudience {
  if (!decision) return now
  if (decision.conversationId !== conversationId) return { ...now, solo: false }
  return { ...now, solo: now.solo && decision.solo }
}
