import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { conversationPersonalSources, type PersonalSource } from '@/lib/db/schema/conversation-personal-sources'
import { isSoloAudience } from './cross-project-use'
import { readConversationAudience, type ConversationAudienceRow } from './restricted-use-repository'

export type { PersonalSource }

export function mayDrawOnPersonal(audience: ConversationAudienceRow, userId: string, turnProjectId: string | null): boolean {
  if (turnProjectId) return false
  if (audience.exists && audience.projectId !== null) return false
  return isSoloAudience(audience, userId)
}

export async function conversationMayDrawOnPersonal(
  organizationId: string,
  userId: string,
  conversationId: string,
  turnProjectId: string | null,
): Promise<boolean> {
  if (turnProjectId) return false
  return mayDrawOnPersonal(await readConversationAudience(getDb(), organizationId, conversationId), userId, turnProjectId)
}

export async function recordPersonalSources(
  organizationId: string,
  conversationId: string,
  sources: readonly PersonalSource[],
  executor: DbExecutor = getDb(),
): Promise<void> {
  if (sources.length === 0) return
  await executor
    .insert(conversationPersonalSources)
    .values([...new Set(sources)].map((source) => ({ organizationId, conversationId, source })))
    .onConflictDoUpdate({
      target: [
        conversationPersonalSources.organizationId,
        conversationPersonalSources.conversationId,
        conversationPersonalSources.source,
      ],
      set: { lastAt: sql`now()` },
    })
}

export async function listPersonalSources(
  executor: DbExecutor,
  organizationId: string,
  conversationId: string,
): Promise<PersonalSource[]> {
  const rows = await executor
    .select({ source: conversationPersonalSources.source })
    .from(conversationPersonalSources)
    .where(
      and(
        eq(conversationPersonalSources.organizationId, organizationId),
        eq(conversationPersonalSources.conversationId, conversationId),
      ),
    )
    .orderBy(conversationPersonalSources.source)
  return rows.map((row) => row.source)
}
