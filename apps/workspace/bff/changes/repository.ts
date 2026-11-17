import 'server-only'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { pilotiChanges, type NewAgentChangeRow, type AgentChangeRow } from '@/lib/db/schema/piloti-changes'
import { withTenant } from '@/lib/db/tenant-context'

export type { AgentChangeRow }

export const MAX_CHANGES_PER_TURN = 200

export type NewAgentChange = Omit<NewAgentChangeRow, 'id' | 'createdAt' | 'undoneAt' | 'undoneBy'>

export async function insertAgentChanges(organizationId: string, rows: readonly NewAgentChange[]): Promise<AgentChangeRow[]> {
  if (rows.length === 0) return []
  if (rows.some((row) => row.organizationId !== organizationId)) {
    throw new Error('insertAgentChanges: every change belongs to the one organization named')
  }
  const db = getDb()
  return withTenant({ organizationId }, () => db.insert(pilotiChanges).values([...rows]).returning())
}

export async function listTurnChangeRows(
  organizationId: string,
  conversationId: string,
  messageId: string
): Promise<AgentChangeRow[]> {
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select()
      .from(pilotiChanges)
      .where(
        and(
          eq(pilotiChanges.organizationId, organizationId),
          eq(pilotiChanges.originMessageId, messageId),
          eq(pilotiChanges.originConversationId, conversationId)
        )
      )
      .orderBy(asc(pilotiChanges.createdAt), asc(pilotiChanges.id))
      .limit(MAX_CHANGES_PER_TURN)
  )
}

export async function findAgentChange(organizationId: string, id: string): Promise<AgentChangeRow | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(pilotiChanges)
      .where(and(eq(pilotiChanges.organizationId, organizationId), eq(pilotiChanges.id, id)))
      .limit(1)
  )
  return row ?? null
}

export async function claimUndo(organizationId: string, id: string, userId: string): Promise<AgentChangeRow | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .update(pilotiChanges)
      .set({ undoneAt: new Date(), undoneBy: userId })
      .where(and(eq(pilotiChanges.organizationId, organizationId), eq(pilotiChanges.id, id), isNull(pilotiChanges.undoneAt)))
      .returning()
  )
  return row ?? null
}

export async function releaseUndo(
  organizationId: string,
  claim: Pick<AgentChangeRow, 'id' | 'undoneAt' | 'undoneBy'>
): Promise<void> {
  const { undoneAt: at, undoneBy: by } = claim
  if (!at || !by) return
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(pilotiChanges)
      .set({ undoneAt: null, undoneBy: null })
      .where(
        and(
          eq(pilotiChanges.organizationId, organizationId),
          eq(pilotiChanges.id, claim.id),
          eq(pilotiChanges.undoneBy, by),
          eq(pilotiChanges.undoneAt, at)
        )
      )
  )
}
