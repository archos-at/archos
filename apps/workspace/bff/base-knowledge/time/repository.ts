/**
 * The SQL of "which edition applied" (ADR-0171): a work's editions with their
 * in-force dates and transitions, and how far back its history is held. Runs as
 * the office (`withTenant`) and names the owner and entitlement condition
 * itself: the office's own records, or released platform records of a country
 * it is entitled to. The layered RLS is the backstop, not the filter.
 *
 * Fail closed on the stored data: a transition the current schema cannot read
 * is reported, never skipped, since skipping it would let the reference date
 * decide a boundary the transition decides.
 */

import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { transitionTableSchema, type DatedEdition } from '@/lib/base-knowledge/wire/time'
import { territoryChain } from '../platform/applicability'
import { readTerritoryParents } from '../platform/territories'
import type { WorkInTime } from './as-of'

/** Most editions one work has; a consolidated law has one per in-force date, so this is generous. */
export const MAX_EDITIONS = 500

/** The office's own row, or a platform row of a country it is entitled to. */
const visible = (alias: 'wr' | 'er', organizationId: string) =>
  sql`(${sql.raw(alias)}.organization_id = ${organizationId} OR (${sql.raw(alias)}.organization_id IS NULL AND knowledge_country_entitled(${sql.raw(alias)}.country_id)))`

/** A `date` column as an ISO date, whichever form the driver returns it in. */
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
  /** Editions whose transition the current schema cannot read. */
  unreadable: string[]
  /** More than {@link MAX_EDITIONS}: the read is incomplete and decides nothing. */
  truncated: boolean
}

/** The work and its editions in force (at their heads), or null when the office sees no such work. */
export async function readWorkInTime(
  organizationId: string,
  workId: string
): Promise<WorkInTimeRead | null> {
  return withTenant({ organizationId }, async () => {
    const db = getDb()
    const works = await db.execute<WorkRow>(sql`
      SELECT w.history_available_from
      FROM knowledge_records wr JOIN knowledge_work_revisions w ON w.revision_id = wr.head_revision_id
      WHERE wr.id = ${workId} AND wr.type = 'work' AND ${visible('wr', organizationId)}`)
    const [work] = works
    if (!work) return null
    const rows = await db.execute<EditionRow>(sql`
      SELECT er.id, e.label, e.in_force_from, e.in_force_to, e.transition
      FROM knowledge_records er JOIN knowledge_edition_revisions e ON e.revision_id = er.head_revision_id
      WHERE er.type = 'edition' AND e.work_id = ${workId} AND ${visible('er', organizationId)}
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

/** The legislating node and every territory it lies in, nearest first. */
export async function readTerritoryChain(
  organizationId: string,
  territoryId: string
): Promise<string[]> {
  const parents = await withTenant({ organizationId }, () =>
    readTerritoryParents(getDb(), territoryId)
  )
  return territoryChain(territoryId, parents)
}
