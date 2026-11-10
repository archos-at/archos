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
 *     APP_DATABASE_URL=postgres://app_rw:…@…/app bun run register:import -- --zip … --apply
 *         # write it as a new release and make it the active one
 *
 * `--apply` connects as the runtime role and steps up to the platform role per
 * transaction (`workers/platform-scope.js`), the one role that writes platform
 * tables. A release that would shrink the active one by more than 5 % is
 * refused (`--max-shrink 0.2` to accept more, after looking at why). Runbook:
 * docs/deployment/address-register.md.
 */

import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import postgres from 'postgres'
import { bevAttribution, bevEntry, bevLookups, csvRecords, type RegisterEntry } from '../bff/site-resolution/bev'
import { DEFAULT_MAX_SHRINK, importRelease, type WithPlatform } from '../bff/site-resolution/import'
import { BEV_ADDRESS_REGISTER } from '../bff/site-resolution/registers'
// CommonJS, shared with the purger and the scheduler: the one place the step-up is spelled.
import platformScope from '../workers/platform-scope.js'

const TABLES = ['GEMEINDE.csv', 'ORTSCHAFT.csv', 'STRASSE.csv', 'ADRESSE.csv', 'Aktualitaetsstand.txt'] as const

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}

/** The lines of a UTF-8 file, decoded a megabyte at a time: ADRESSE.csv is a third of a gigabyte. */
function* linesOf(bytes: Uint8Array): Generator<string> {
  const decoder = new TextDecoder('utf-8')
  let rest = ''
  for (let offset = 0; offset < bytes.length; offset += 1 << 20) {
    const chunk = rest + decoder.decode(bytes.subarray(offset, offset + (1 << 20)), { stream: true })
    const lines = chunk.split('\n')
    rest = lines.pop() ?? ''
    yield* lines
  }
  rest += decoder.decode()
  if (rest) yield rest
}

/** "Aktualitätsstand (Stichtag) der enthaltenen Daten: 01.10.2025" → 2025-10-01. Latin-1, as the BEV writes it. */
function referenceDateOf(file: Uint8Array | undefined): string | null {
  if (!file) return null
  const match = /(\d{2})\.(\d{2})\.(\d{4})/.exec(new TextDecoder('latin1').decode(file))
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null
}

async function archive(stated: string | null): Promise<{ files: Record<string, Uint8Array>; sourceUrl: string | null }> {
  const zip = argument('--zip')
  if (zip) return { files: unzipSync(readFileSync(zip), { filter: (file) => TABLES.some((name) => file.name.endsWith(name)) }), sourceUrl: null }
  if (!process.argv.includes('--download') || !stated) fail('Give --zip <file>, or --download with --reference-date YYYY-MM-DD.')
  const url = BEV_ADDRESS_REGISTER.downloadUrl(stated)
  console.log(`Downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok) fail(`The BEV answered ${response.status} for ${url}.`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  return { files: unzipSync(bytes, { filter: (file) => TABLES.some((name) => file.name.endsWith(name)) }), sourceUrl: url }
}

function table(files: Record<string, Uint8Array>, name: string): Uint8Array {
  const found = Object.entries(files).find(([path]) => path.endsWith(name))
  if (!found) fail(`The archive has no ${name}.`)
  return found[1]
}

async function main(): Promise<void> {
  const stated = argument('--reference-date')
  if (stated && !/^\d{4}-\d{2}-\d{2}$/.test(stated)) fail('--reference-date is YYYY-MM-DD.')
  const { files, sourceUrl } = await archive(stated)
  const inArchive = referenceDateOf(Object.entries(files).find(([path]) => path.endsWith('Aktualitaetsstand.txt'))?.[1])
  if (stated && inArchive && stated !== inArchive) fail(`--reference-date ${stated}, but the archive says ${inArchive}.`)
  const referenceDate = stated ?? inArchive ?? fail('The archive names no reference date; give --reference-date.')

  const lookups = bevLookups({
    gemeinde: csvRecords(linesOf(table(files, 'GEMEINDE.csv'))),
    ortschaft: csvRecords(linesOf(table(files, 'ORTSCHAFT.csv'))),
    strasse: csvRecords(linesOf(table(files, 'STRASSE.csv'))),
  })
  let skipped = 0
  function* entries(): Generator<RegisterEntry> {
    for (const row of csvRecords(linesOf(table(files, 'ADRESSE.csv')))) {
      const entry = bevEntry(row, lookups)
      if (entry) yield entry
      else skipped += 1
    }
  }

  if (!process.argv.includes('--apply')) {
    let count = 0
    for (const _ of entries()) count += 1
    console.log(`${BEV_ADDRESS_REGISTER.id} ${referenceDate}: ${count} addresses, ${skipped} rows skipped, ${lookups.municipalities.size} municipalities. Nothing written (--apply writes).`)
    return
  }
  const url = process.env.APP_DATABASE_URL ?? fail('APP_DATABASE_URL is required with --apply.')
  const maxShrink = Number(argument('--max-shrink') ?? DEFAULT_MAX_SHRINK)
  const sql = postgres(url, { max: 1 })
  const withPlatform: WithPlatform = (fn) =>
    sql.begin(async (tx) => {
      await platformScope.enterPlatformScope(tx)
      return fn(tx)
    }) as ReturnType<typeof fn>
  try {
    const result = await importRelease(withPlatform, {
      register: BEV_ADDRESS_REGISTER,
      referenceDate,
      attribution: bevAttribution(referenceDate),
      sourceUrl,
      entries: entries(),
      maxShrink,
    })
    console.log(`${BEV_ADDRESS_REGISTER.id} ${referenceDate}: release ${result.releaseId} active with ${result.entryCount} addresses (${skipped} rows skipped); retired ${result.retiredReleaseIds.length}.`)
  } finally {
    await sql.end()
  }
}

await main()
