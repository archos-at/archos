/**
 * The SQL of the address registers (migration 0206, ADR-0172). Reads only:
 * the importer is the one writer. Every statement reads the register's active
 * release, so a half-written import is never read. Bounded: one lookup returns
 * at most {@link MAX_MATCHES} rows.
 */

import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'

/** Most rows one lookup reads; more is an ambiguous line, not a list to page through. */
export const MAX_MATCHES = 50

export interface ActiveRelease {
  id: string
  register: string
  referenceDate: string
  attribution: string
}

export interface RegisterRow {
  release: ActiveRelease
  addressId: string
  municipalityCode: string
  municipalityName: string
  localityName: string | null
  postcode: string
  streetName: string
  houseNumber: string
  houseKey: string
  placeKeys: string[]
}

interface RawRow extends Record<string, unknown> {
  release_id: string
  register: string
  reference_date: string | Date
  attribution: string
  address_id: string
  municipality_code: string
  municipality_name: string
  locality_name: string | null
  postcode: string
  street_name: string
  house_number: string
  house_key: string
  place_keys: string[]
}

function isoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function rowOf(raw: RawRow): RegisterRow {
  return {
    release: { id: raw.release_id, register: raw.register, referenceDate: isoDate(raw.reference_date), attribution: raw.attribution },
    addressId: raw.address_id,
    municipalityCode: raw.municipality_code,
    municipalityName: raw.municipality_name,
    localityName: raw.locality_name,
    postcode: raw.postcode,
    streetName: raw.street_name,
    houseNumber: raw.house_number,
    houseKey: raw.house_key,
    placeKeys: [...(raw.place_keys ?? [])],
  }
}

const SELECT_ROW = sql`
  SELECT e.release_id, r.register, r.reference_date, r.attribution, e.address_id, e.municipality_code,
    e.municipality_name, e.locality_name, e.postcode, e.street_name, e.house_number, e.house_key, e.place_keys
  FROM address_register_entries e
  JOIN address_register_releases r ON r.id = e.release_id AND r.status = 'active'`

/** The active release of each of `registers` that has one. */
export async function activeReleases(organizationId: string, registers: readonly string[]): Promise<ActiveRelease[]> {
  if (registers.length === 0) return []
  const rows = await withTenant({ organizationId }, () =>
    getDb().execute<{ id: string; register: string; reference_date: string | Date; attribution: string }>(sql`
      SELECT id, register, reference_date, attribution FROM address_register_releases
      WHERE status = 'active' AND register = ANY(${sql.param([...registers])}::text[])`)
  )
  return rows.map((row) => ({ id: row.id, register: row.register, referenceDate: isoDate(row.reference_date), attribution: row.attribution }))
}

/**
 * Addresses of the active releases of `registers` whose street key and one of
 * `houseKeys` match exactly, filtered here by `postcode` or, without one, by
 * `placeKey`: a street and number common across Austria ("Hauptplatz 7") has
 * more than {@link MAX_MATCHES} rows, and a cap applied before the filter
 * would drop the one the line names.
 */
export async function findByKeys(
  organizationId: string,
  query: { registers: readonly string[]; streetKey: string; houseKeys: readonly string[]; postcode: string | null; placeKey: string | null }
): Promise<RegisterRow[]> {
  if (query.registers.length === 0 || query.houseKeys.length === 0) return []
  const narrowing = query.postcode
    ? sql`AND e.postcode = ${query.postcode}`
    : query.placeKey
      ? // The place itself, or a district written after it ("wieninnerestadt" in "wien"), as `match.ts` reads it.
        // Keys are letters and digits only, so LIKE sees no wildcard in them.
        sql`AND EXISTS (SELECT 1 FROM unnest(e.place_keys) AS p(key)
              WHERE p.key = ${query.placeKey} OR (length(p.key) >= 3 AND ${query.placeKey} LIKE p.key || '%'))`
      : sql``
  const rows = await withTenant({ organizationId }, () =>
    getDb().execute<RawRow>(sql`${SELECT_ROW}
      WHERE r.register = ANY(${sql.param([...query.registers])}::text[])
        AND e.street_key = ${query.streetKey}
        AND e.house_key = ANY(${sql.param([...query.houseKeys])}::text[])
        ${narrowing}
      ORDER BY e.municipality_code, e.postcode, e.address_id
      LIMIT ${MAX_MATCHES}`)
  )
  return rows.map(rowOf)
}

/** One address of a register's active release by the register's own id, or null. */
export async function findByAddressId(organizationId: string, register: string, addressId: string): Promise<RegisterRow | null> {
  const rows = await withTenant({ organizationId }, () =>
    getDb().execute<RawRow>(sql`${SELECT_ROW}
      WHERE r.register = ${register} AND e.address_id = ${addressId}
      LIMIT 1`)
  )
  return rows[0] ? rowOf(rows[0]) : null
}
