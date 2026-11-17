/**
 * Import the BEV Adressregister into the cell's database (ADR-0172), or show
 * what it would import.
 *
 * The register is a public bulk file ("Adresse Relationale Tabellen –
 * Stichtagsdaten", CC BY 4.0) the BEV publishes twice a year. It is downloaded
 * once, whole: no address anyone types is ever sent anywhere. Lookups read the
 * imported rows (`bff/site-resolution/`).
 *
 *   Usage (from apps/workspace):
 *     bun run register:import -- --zip ./Adresse_Relationale_Tabellen_Stichtagsdaten_20251001.zip
 *         # parse it, count, change nothing
 *     bun run register:import -- --reference-date 2025-10-01 --download
 *         # the same, fetching the archive from data.bev.gv.at
 *
 * What describes the register (its id, rows' municipality and state, postcodes,
 * download address) is the `addressRegister` block of the country's
 * `fact_definitions` record, not code: the script reads it from the pack file
 * the operator proposed (`--pack`, default `configs/knowledge-packs/at-setup.json`).
 * The BEV file's own format (`bev-archive.ts`) is what this script is code for.
 *
 *     APP_DATABASE_URL=postgres://app_rw:…@…/app bun run register:import -- --zip … --apply
 *         # write it as a new release and make it the active one
 *
 * `--apply` connects as the runtime role and steps up to the platform role per
 * transaction (`workers/platform-scope.js`), the one role that writes platform
 * tables. A release that would shrink the active one by more than 5 % is
 * refused (`--max-shrink 0.2` to accept more, after looking at why), and so is
 * a release not newer than the active one (`--allow-older` to roll back). Runbook:
 * docs/deployment/address-register.md.
 */

import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { bevAttribution } from '../bff/site-resolution/bev'
import { readBevArchive } from '../bff/site-resolution/bev-archive'
import { DEFAULT_MAX_SHRINK, importRelease, type WithPlatform } from '../bff/site-resolution/import'
import { registerFromRecord, type AddressRegister } from '../bff/site-resolution/registers'
import { factDefinitionsSchema } from '../bff/base-knowledge/wire/setup-facts'
// CommonJS, shared with the purger and the scheduler: the one place the step-up is spelled.
import platformScope from '../workers/platform-scope.js'

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

/** The register the pack's `fact_definitions` record describes: the one the BEV importer reads. */
function registerOfPack(): AddressRegister {
  const path = argument('--pack') ?? new URL('../../../configs/knowledge-packs/at-setup.json', import.meta.url).pathname
  const pack = JSON.parse(readFileSync(path, 'utf8')) as { records: Array<{ type: string; values?: { territoryIds: string[]; body: { kind: string; payload: unknown } } }> }
  for (const record of pack.records) {
    if (record.type !== 'ruleset' || record.values?.body.kind !== 'fact_definitions') continue
    const payload = factDefinitionsSchema.parse(record.values.body.payload)
    if (payload.addressRegister) return registerFromRecord(record.values.territoryIds[0] ?? '', payload.addressRegister)
  }
  return fail(`${path} holds no fact_definitions record with an addressRegister.`)
}

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}

async function archiveBytes(register: AddressRegister, stated: string | null): Promise<{ bytes: Uint8Array; sourceUrl: string | null }> {
  const zip = argument('--zip')
  if (zip) return { bytes: readFileSync(zip), sourceUrl: null }
  if (!process.argv.includes('--download') || !stated) fail('Give --zip <file>, or --download with --reference-date YYYY-MM-DD.')
  const url = register.downloadUrl(stated)
  console.log(`Downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok) fail(`The BEV answered ${response.status} for ${url}.`)
  return { bytes: new Uint8Array(await response.arrayBuffer()), sourceUrl: url }
}

async function main(): Promise<void> {
  const stated = argument('--reference-date')
  if (stated && !/^\d{4}-\d{2}-\d{2}$/.test(stated)) fail('--reference-date is YYYY-MM-DD.')
  const register = registerOfPack()
  const { bytes, sourceUrl } = await archiveBytes(register, stated)
  const archive = readBevArchive(bytes)
  if (stated && archive.referenceDate && stated !== archive.referenceDate)
    fail(`--reference-date ${stated}, but the archive says ${archive.referenceDate}.`)
  const referenceDate = stated ?? archive.referenceDate ?? fail('The archive names no reference date; give --reference-date.')

  if (!process.argv.includes('--apply')) {
    let count = 0
    for (const _ of archive.entries()) count += 1
    console.log(
      `${register.id} ${referenceDate}: ${count} addresses, ${archive.skipped()} rows skipped, ` +
        `${archive.lookups.municipalities.size} municipalities. Nothing written (--apply writes).`
    )
    return
  }
  const url = process.env.APP_DATABASE_URL ?? fail('APP_DATABASE_URL is required with --apply.')
  const rawShrink = argument('--max-shrink')
  const maxShrink = rawShrink === null ? DEFAULT_MAX_SHRINK : Number(rawShrink)
  if (!Number.isFinite(maxShrink) || maxShrink < 0 || maxShrink >= 1) fail(`--max-shrink is a number from 0 to below 1, e.g. 0.2; got ${rawShrink}.`)
  const sql = postgres(url, { max: 1 })
  const withPlatform: WithPlatform = (fn) =>
    sql.begin(async (tx) => {
      await platformScope.enterPlatformScope(tx)
      return fn(tx)
    }) as ReturnType<typeof fn>
  try {
    const result = await importRelease(withPlatform, {
      register,
      referenceDate,
      attribution: bevAttribution(referenceDate),
      sourceUrl,
      entries: archive.entries(),
      maxShrink,
      allowOlder: process.argv.includes('--allow-older'),
    })
    console.log(
      `${register.id} ${referenceDate}: release ${result.releaseId} active with ${result.entryCount} addresses ` +
        `(${archive.skipped()} rows skipped); retired ${result.retiredReleaseIds.length}.`
    )
  } finally {
    await sql.end()
  }
}

await main()
