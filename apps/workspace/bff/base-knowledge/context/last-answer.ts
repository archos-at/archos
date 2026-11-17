/**
 * Whether the base moved since a conversation's last answer (E42, ADR-0173):
 * the pack sequences its newest recorded answer was resolved at
 * (`message_edition_uses`), against the turn's own. A pack released since makes
 * the answer say "Grundlage seit der letzten Antwort aktualisiert".
 */

import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import type { KnowledgeContext } from './wire'

/** The packs whose sequence moved past what the conversation's last recorded answer was resolved at. Pure. */
export function packsUpdatedSince(current: KnowledgeContext['packs'], previous: Readonly<Record<string, number>> | null): string[] {
  if (!previous) return []
  return current.filter((pack) => previous[pack.packId] !== undefined && pack.seq > (previous[pack.packId] as number)).map((pack) => pack.packId)
}

/** The pack sequences the conversation's newest recorded answer was resolved at; null when none recorded a use. */
export async function lastAnswerPackSeqs(organizationId: string, conversationId: string): Promise<Record<string, number> | null> {
  const rows = await withTenant({ organizationId }, () =>
    getDb().execute<{ pack_seqs: Record<string, number> }>(sql`
      SELECT u.pack_seqs FROM message_edition_uses u JOIN messages m ON m.id = u.message_id
      WHERE u.organization_id = ${organizationId} AND m.organization_id = ${organizationId} AND m.conversation_id = ${conversationId}
      ORDER BY u.created_at DESC LIMIT 1`),
  )
  return rows[0]?.pack_seqs ?? null
}
