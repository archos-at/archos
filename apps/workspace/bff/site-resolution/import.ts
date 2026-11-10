/**
 * Write one release of an official address register into the cell (migration
 * 0206, ADR-0172). The one writer of `address_register_entries`; the script
 * `scripts/import-address-register.ts` drives it, and the integration spec
 * drives the same function. No `server-only`: it runs outside Next.
 *
 * Three steps, each a transaction stepped up to the platform role by the
 * caller's `withPlatform` (`workers/platform-scope.js`):
 * 1. a `loading` release row;
 * 2. the entries, in batches; a lookup never reads a loading release;
 * 3. the swap: the new release becomes `active`, the previous one `retired`
 *    and its entries deleted, in one transaction.
 *
 * Fail closed: a release with no entries, one that shrinks the active release
 * by more than `maxShrink`, or one whose reference date is not after the
 * active one's (unless `allowOlder`), is refused and removed, and the active
 * release stays. A register does not lose a twentieth of its addresses between
 * two reference dates; a truncated download does. A `maxShrink` that is not a
 * number in [0, 1) is refused before anything is written. A `loading` release
 * older than a day, left by an import that died, is removed first.
 */

import type { TransactionSql } from 'postgres'
import type { RegisterEntry } from './bev'
import type { AddressRegister } from './registers'

/** Rows per INSERT: 14 columns each, under Postgres's 65,535 bind parameters a statement. */
export const IMPORT_BATCH_SIZE = 4_000
/** The share of the active release a new one may lose before it is refused. */
export const DEFAULT_MAX_SHRINK = 0.05

export type WithPlatform = <T>(fn: (tx: TransactionSql) => Promise<T>) => Promise<T>

export interface ImportRelease {
  register: AddressRegister
  referenceDate: string
  attribution: string
  sourceUrl: string | null
  entries: Iterable<RegisterEntry> | AsyncIterable<RegisterEntry>
  maxShrink?: number
  /** Accept a reference date not after the active release's: a rollback to an earlier archive. */
  allowOlder?: boolean
}

export interface ImportResult {
  releaseId: string
  entryCount: number
  retiredReleaseIds: string[]
}

/** A release refused at the swap: too small next to the active one, or empty. */
export class ReleaseRefusedError extends Error {
  override name = 'ReleaseRefusedError'
}

/** An entry as the columns of its row. */
export function columnsOf(releaseId: string, entry: RegisterEntry) {
  return {
    release_id: releaseId,
    address_id: entry.addressId,
    municipality_code: entry.municipalityCode,
    municipality_name: entry.municipalityName,
    locality_name: entry.localityName,
    postcode: entry.postcode,
    street_name: entry.streetName,
    house_number: entry.houseNumber,
    street_key: entry.streetKey,
    house_key: entry.houseKey,
    place_keys: entry.placeKeys,
    easting: entry.easting,
    northing: entry.northing,
    crs: entry.crs,
  }
}

async function writeBatches(withPlatform: WithPlatform, releaseId: string, entries: ImportRelease['entries']): Promise<number> {
  let batch: ReturnType<typeof columnsOf>[] = []
  let written = 0
  const seen = new Set<string>()
  const flush = async () => {
    if (batch.length === 0) return
    const rows = batch
    batch = []
    await withPlatform((tx) => tx`INSERT INTO address_register_entries ${tx(rows)}`.then(() => undefined))
    written += rows.length
  }
  for await (const entry of entries) {
    if (seen.has(entry.addressId)) continue
    seen.add(entry.addressId)
    batch.push(columnsOf(releaseId, entry))
    if (batch.length >= IMPORT_BATCH_SIZE) await flush()
  }
  await flush()
  return written
}

/** The shrink a release may show, refused when it is no number in [0, 1): NaN would switch the guard off. */
function maxShrinkOf(release: ImportRelease): number {
  const maxShrink = release.maxShrink ?? DEFAULT_MAX_SHRINK
  if (!Number.isFinite(maxShrink) || maxShrink < 0 || maxShrink >= 1)
    throw new ReleaseRefusedError(`maxShrink must be a number from 0 to below 1, not ${String(release.maxShrink)}.`)
  return maxShrink
}

async function activate(withPlatform: WithPlatform, release: ImportRelease, releaseId: string, entryCount: number): Promise<string[]> {
  const maxShrink = maxShrinkOf(release)
  return withPlatform(async (tx) => {
    const active = await tx<{ id: string; entry_count: number; reference_date: string }[]>`
      SELECT id, entry_count, reference_date::text FROM address_register_releases
      WHERE register = ${release.register.id} AND status = 'active' FOR UPDATE`
    if (active[0] && !release.allowOlder && release.referenceDate <= active[0].reference_date)
      throw new ReleaseRefusedError(
        `${release.register.id} ${release.referenceDate} is not after the active release's ${active[0].reference_date}; ` +
          'pass allowOlder to roll back to it.'
      )
    const floor = active[0] ? Math.ceil(active[0].entry_count * (1 - maxShrink)) : 1
    if (entryCount < Math.max(floor, 1))
      throw new ReleaseRefusedError(
        `${release.register.id} ${release.referenceDate}: ${entryCount} addresses, the active release has ` +
          `${active[0]?.entry_count ?? 0}; at least ${Math.max(floor, 1)} are needed (maxShrink ${maxShrink}).`
      )
    const retired = active.map((row) => row.id)
    if (retired.length > 0) {
      await tx`UPDATE address_register_releases SET status = 'retired' WHERE id = ANY(${retired}::uuid[])`
      await tx`DELETE FROM address_register_entries WHERE release_id = ANY(${retired}::uuid[])`
    }
    await tx`
      UPDATE address_register_releases SET status = 'active', entry_count = ${entryCount}, activated_at = now()
      WHERE id = ${releaseId}`
    return retired
  })
}

/** Import a release and make it the register's active one, or refuse it and leave the active release as it was. */
export async function importRelease(withPlatform: WithPlatform, release: ImportRelease): Promise<ImportResult> {
  maxShrinkOf(release)
  await withPlatform((tx) =>
    tx`DELETE FROM address_register_releases
       WHERE register = ${release.register.id} AND status = 'loading' AND imported_at < now() - interval '1 day'`.then(() => undefined)
  )
  const [{ id: releaseId }] = await withPlatform((tx) => tx<{ id: string }[]>`
    INSERT INTO address_register_releases (register, country_id, reference_date, attribution, source_url)
    VALUES (${release.register.id}, ${release.register.country}, ${release.referenceDate}, ${release.attribution}, ${release.sourceUrl})
    RETURNING id`)
  try {
    const entryCount = await writeBatches(withPlatform, releaseId, release.entries)
    const retiredReleaseIds = await activate(withPlatform, release, releaseId, entryCount)
    return { releaseId, entryCount, retiredReleaseIds }
  } catch (error) {
    await withPlatform((tx) => tx`DELETE FROM address_register_releases WHERE id = ${releaseId}`.then(() => undefined))
    throw error
  }
}
