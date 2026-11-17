import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'

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

export async function activeReleases(organizationId: string, registers: readonly string[]): Promise<ActiveRelease[]> {
  if (registers.length === 0) return []
  const rows = await withTenant({ organizationId }, () =>
    getDb().execute<{ id: string; register: string; reference_date: string | Date; attribution: string }>(sql`
      SELECT id, register, reference_date, attribution FROM address_register_releases
      WHERE status = 'active' AND register = ANY(${sql.param([...registers])}::text[])`)
  )
  return rows.map((row) => ({ id: row.id, register: row.register, referenceDate: isoDate(row.reference_date), attribution: row.attribution }))
}

export async function findByKeys(
  organizationId: string,
  query: { registers: readonly string[]; streetKey: string; houseKeys: readonly string[]; postcode: string | null; placeKeys: readonly string[] | null }
): Promise<RegisterRow[]> {
  if (query.registers.length === 0 || query.houseKeys.length === 0) return []
  const narrowing = query.postcode
    ? sql`AND e.postcode = ${query.postcode}`
    : query.placeKeys && query.placeKeys.length > 0
      ? // The keys `placeKeysOf` gives, compared whole, as `match.ts` compares them.
        sql`AND e.place_keys && ${sql.param([...query.placeKeys])}::text[]`
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

export async function findByAddressId(organizationId: string, register: string, addressId: string): Promise<RegisterRow | null> {
  const rows = await withTenant({ organizationId }, () =>
    getDb().execute<RawRow>(sql`${SELECT_ROW}
      WHERE r.register = ${register} AND e.address_id = ${addressId}
      LIMIT 1`)
  )
  return rows[0] ? rowOf(rows[0]) : null
}
