import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { transitionTableSchema, type DatedEdition } from '@/lib/base-knowledge/wire/time'
import { chainAt } from '../chain/territory-chain'
import { readTerritoryParents } from '../platform/territories'
import { recordReadable } from '../store/visibility'
import type { WorkInTime } from './as-of'

export const MAX_EDITIONS = 500

export function isoDateOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const text = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null
}

interface WorkRow extends Record<string, unknown> {
  history_available_from: unknown
}

interface EditionRow extends Record<string, unknown> {
  id: string
  label: string
  in_force_from: unknown
  in_force_to: unknown
  transition: unknown
}

export interface WorkInTimeRead {
  work: WorkInTime
  unreadable: string[]
  truncated: boolean
}

export async function readWorkInTime(
  organizationId: string,
  workId: string
): Promise<WorkInTimeRead | null> {
  return withTenant({ organizationId }, async () => {
    const db = getDb()
    const works = await db.execute<WorkRow>(sql`
      SELECT w.history_available_from
      FROM knowledge_records wr JOIN knowledge_work_revisions w ON w.revision_id = wr.head_revision_id
      WHERE wr.id = ${workId} AND wr.type = 'work' AND ${recordReadable('wr', organizationId)}`)
    const [work] = works
    if (!work) return null
    const rows = await db.execute<EditionRow>(sql`
      SELECT er.id, e.label, e.in_force_from, e.in_force_to, e.transition
      FROM knowledge_records er JOIN knowledge_edition_revisions e ON e.revision_id = er.head_revision_id
      WHERE er.type = 'edition' AND e.work_id = ${workId} AND ${recordReadable('er', organizationId)}
      ORDER BY e.in_force_from NULLS FIRST, er.id
      LIMIT ${MAX_EDITIONS + 1}`)
    const unreadable: string[] = []
    const editions: DatedEdition[] = rows.slice(0, MAX_EDITIONS).map((row) => {
      const parsed =
        row.transition === null ? null : transitionTableSchema.safeParse(row.transition)
      if (parsed && !parsed.success) unreadable.push(row.id)
      return {
        id: row.id,
        label: String(row.label),
        inForceFrom: isoDateOf(row.in_force_from),
        inForceTo: isoDateOf(row.in_force_to),
        transition: parsed?.success ? parsed.data : null,
      }
    })
    return {
      work: { id: workId, historyAvailableFrom: isoDateOf(work.history_available_from), editions },
      unreadable,
      truncated: rows.length > MAX_EDITIONS,
    }
  })
}

export async function readTerritoryChain(
  organizationId: string,
  territoryId: string,
  date: string
): Promise<string[]> {
  const parents = await withTenant({ organizationId }, () =>
    readTerritoryParents(getDb(), organizationId, territoryId)
  )
  return chainAt(territoryId, date, (id) => parents.get(id))
}

export async function readTerritoryZones(
  organizationId: string,
  territoryIds: readonly string[]
): Promise<Record<string, string>> {
  if (territoryIds.length === 0) return {}
  const rows = await withTenant({ organizationId }, () =>
    getDb().execute<{ id: string; zone: string }>(sql`
      SELECT r.id, t.zone
      FROM knowledge_records r JOIN knowledge_territory_revisions t ON t.revision_id = r.head_revision_id
      WHERE r.type = 'territory' AND r.id IN (${sql.join(territoryIds.map((id) => sql`${id}`), sql`, `)})
        AND t.zone IS NOT NULL AND ${recordReadable('r', organizationId)}`)
  )
  return Object.fromEntries(rows.map((row) => [row.id, String(row.zone)]))
}
