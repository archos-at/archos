/**
 * A territory's parents, read from the platform's territory records (ADR-0165,
 * design §3.2 `parents`); `chain/territory-chain.ts` `chainAt` walks them.
 * Runs inside the caller's `withTenant`; names the office's read itself
 * (`store/visibility.ts`), so the layered RLS is the backstop, not the filter.
 */

import 'server-only'
import { sql } from 'drizzle-orm'
import type { getDb } from '@/lib/db'
import { walkSeeds, type TerritoryParent } from '../chain/territory-chain'
import { sqlTextArray } from '@/lib/db/sql-list'
import { recordReadable } from '../store/visibility'

interface TerritoryRow extends Record<string, unknown> {
  id: string
  parents: TerritoryParent[]
}

/** Each territory on `territoryId`'s way up (itself included, at most 16 levels) with its parents, dated ones included. */
export async function readTerritoryParents(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  territoryId: string
): Promise<Map<string, TerritoryParent[]>> {
  const rows = await db.execute<TerritoryRow>(sql`
    WITH RECURSIVE chain(id, depth) AS (
      SELECT unnest(${sqlTextArray(walkSeeds(territoryId))}), 0
      UNION
      SELECT p.parent_id, c.depth + 1
      FROM chain c
      JOIN knowledge_records r ON r.id = c.id AND r.organization_id IS NULL AND r.type = 'territory'
      JOIN knowledge_territory_revisions t ON t.revision_id = r.head_revision_id
      CROSS JOIN LATERAL (SELECT d ->> 'id' FROM jsonb_array_elements(t.parents) AS d) AS p(parent_id)
      WHERE c.depth < 16 AND ${recordReadable('r', organizationId)}
    )
    SELECT r.id, t.parents
    FROM knowledge_records r JOIN knowledge_territory_revisions t ON t.revision_id = r.head_revision_id
    WHERE r.organization_id IS NULL AND r.id IN (SELECT id FROM chain) AND ${recordReadable('r', organizationId)}`)
  return new Map(rows.map((row) => [row.id, row.parents]))
}
