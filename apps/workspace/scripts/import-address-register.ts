import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { bevAttribution } from '../bff/site-resolution/bev'
import { readBevArchive } from '../bff/site-resolution/bev-archive'
import { DEFAULT_MAX_SHRINK, importRelease, type WithPlatform } from '../bff/site-resolution/import'
import { registerFromRecord, type AddressRegister } from '../bff/site-resolution/registers'
import { factDefinitionsSchema } from '../bff/base-knowledge/wire/setup-facts'
import platformScope from '../workers/platform-scope.js'

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

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
