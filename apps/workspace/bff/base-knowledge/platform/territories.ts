/**
 * A territory's parents, read from the platform's territory records (ADR-0165),
 * so a pure caller can build its chain (`territoryChain` in `applicability.ts`).
 * Runs inside the caller's `withTenant`; names the owner and entitlement itself,
 * so the layered RLS is the backstop, not the filter.
 */

import 'server-only'
import { sql } from 'drizzle-orm'
import type { getDb } from '@/lib/db'

interface TerritoryRow extends Record<string, unknown> {
  id: string
  parent_ids: string[]
}

/** Each territory on `territoryId`'s way up (itself included, at most 16 levels) with its parent ids. */
export async function readTerritoryParents(
  db: ReturnType<typeof getDb>,
  territoryId: string
): Promise<Map<string, string[]>> {
  const rows = await db.execute<TerritoryRow>(sql`
    WITH RECURSIVE chain(id, depth) AS (
      SELECT ${territoryId}::text, 0
      UNION
      SELECT p.parent_id, c.depth + 1
      FROM chain c
      JOIN knowledge_records r ON r.id = c.id AND r.organization_id IS NULL AND r.type = 'territory'
      JOIN knowledge_territory_revisions t ON t.revision_id = r.head_revision_id
      CROSS JOIN LATERAL unnest(t.parent_ids) AS p(parent_id)
      WHERE c.depth < 16 AND knowledge_country_entitled(r.country_id)
    )
    SELECT r.id, t.parent_ids
    FROM knowledge_records r JOIN knowledge_territory_revisions t ON t.revision_id = r.head_revision_id
    WHERE r.organization_id IS NULL AND r.id IN (SELECT id FROM chain) AND knowledge_country_entitled(r.country_id)`)
  return new Map(rows.map((row) => [row.id, row.parent_ids]))
}
