import 'server-only'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { readConversationAudience, type ConversationAudienceRow } from '@/lib/conversations/restricted-use-repository'
import { isSoloAudience, workspaceReadOf, type ContextAudience, type WorkspaceRead } from './types'
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

const WORKSPACE_READ_ORDER: readonly WorkspaceRead[] = ['none', 'document+projectFacts', 'all']

export function workspaceReadUnder(
  decision: Pick<ConversationDecision, 'conversationId' | 'kind' | 'may'> | null | undefined,
  conversationId: string,
  solo: boolean,
): WorkspaceRead {
  const decided = decision?.conversationId === conversationId ? decision : null
  const live = workspaceReadOf(decided?.kind ?? 'chat', conversationId, solo)
  if (!decided) return live
  const narrower = Math.min(WORKSPACE_READ_ORDER.indexOf(live), WORKSPACE_READ_ORDER.indexOf(decided.may.workspaceRead))
  return WORKSPACE_READ_ORDER[narrower] ?? 'none'
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
