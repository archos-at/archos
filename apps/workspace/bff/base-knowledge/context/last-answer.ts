import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import type { KnowledgeContext } from './wire'

export function packsUpdatedSince(current: KnowledgeContext['packs'], previous: Readonly<Record<string, number>> | null): string[] {
  if (!previous) return []
  return current.filter((pack) => previous[pack.packId] !== undefined && pack.seq > (previous[pack.packId] as number)).map((pack) => pack.packId)
}

export async function lastAnswerPackSeqs(organizationId: string, conversationId: string): Promise<Record<string, number> | null> {
  const rows = await withTenant({ organizationId }, () =>
    getDb().execute<{ pack_seqs: Record<string, number> }>(sql`
      SELECT u.pack_seqs FROM message_edition_uses u JOIN messages m ON m.id = u.message_id
      WHERE u.organization_id = ${organizationId} AND m.organization_id = ${organizationId} AND m.conversation_id = ${conversationId}
      ORDER BY u.created_at DESC LIMIT 1`),
  )
  return rows[0]?.pack_seqs ?? null
}
