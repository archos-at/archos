/**
 * @vitest-environment node
 *
 * The 200-address spike (design 8.2, B6; ADR-0172): the whole BEV register
 * imported into a throwaway Postgres, and 200 of its addresses typed the ways
 * people type them, resolved as the route resolves them. A measurement, not a
 * gate: it needs the archive (a 97 MB download) and runs only under
 *
 *   REGISTER_ARCHIVE=/path/to/Adresse_Relationale_Tabellen_Stichtagsdaten_20251001.zip \
 *     task workspace:register:spike
 *
 * It prints the rates per way of typing and holds the two claims that matter:
 * a verified answer is always the address that was typed (never a neighbour),
 * and an address the register does not hold is never verified.
 */

import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))

const url = process.env.TEST_DATABASE_URL
const archivePath = process.env.REGISTER_ARCHIVE
const SAMPLE = 200
const ORG = `org_spike_${Date.now().toString(36)}`

interface Sampled {
  addressId: string
  municipalityCode: string
  street: string
  number: string
  postcode: string
  municipality: string
}

/** The ways a person types one address; the last is an address the register does not hold. */
const WAYS: Record<string, (address: Sampled) => string> = {
  canonical: (a) => `${a.street} ${a.number}, ${a.postcode} ${a.municipality}`,
  lowercase_no_commas: (a) => `${a.street.toLowerCase().replace(/straße$/, 'str.')} ${a.number} ${a.postcode} ${a.municipality.toLowerCase()}`,
  place_first: (a) => `${a.postcode} ${a.municipality}, ${a.street} ${a.number}`,
  with_door: (a) => `${a.street} ${a.number}/2/5, ${a.postcode} ${a.municipality}`,
  no_postcode: (a) => `${a.street} ${a.number}, ${a.municipality}`,
  street_only: (a) => `${a.street} ${a.number}`,
  absent_number: (a) => `${a.street} 9${a.number}9, ${a.postcode} ${a.municipality}`,
}

describe.skipIf(!url || !archivePath)('the 200-address spike', () => {
  let service: typeof import('./service')
  let raw: import('postgres').Sql
  const sample: Sampled[] = []

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    service = await import('./service')
    const { readBevArchive } = await import('./bev-archive')
    const { importRelease } = await import('./import')
    const { AT_FACT_DEFINITIONS_VALUES, BEV_ADDRESS_REGISTER } = await import('@/lib/project-intake/at-setup.fixtures')
    const { insertOfficeRuleset } = await import('@/lib/base-knowledge/store/rulesets')
    await insertOfficeRuleset(ORG, AT_FACT_DEFINITIONS_VALUES, { createdBy: 'user_spike', provenance: { proposedBy: 'person' }, inForce: true })
    const { bevAttribution } = await import('./bev')
    const scope = (await import('../../workers/platform-scope.js')).default
    raw = (await import('postgres')).default(url!, { max: 2 })
    const withPlatform: import('./import').WithPlatform = (fn) =>
      raw.begin(async (tx) => {
        await scope.enterPlatformScope(tx)
        return fn(tx)
      }) as ReturnType<typeof fn>
    const archive = readBevArchive(readFileSync(archivePath!))
    const all = [...archive.entries()]
    // Every n-th address, so the sample spans every Land and kind of place; deterministic, so runs compare.
    const step = Math.floor(all.length / SAMPLE)
    for (let index = 0; sample.length < SAMPLE; index += step) {
      const entry = all[index]
      sample.push({
        addressId: entry.addressId,
        municipalityCode: entry.municipalityCode,
        street: entry.streetName,
        number: entry.houseNumber,
        postcode: entry.postcode,
        municipality: entry.municipalityName,
      })
    }
    await withPlatform((tx) => tx`DELETE FROM address_register_releases WHERE register = 'at-bev'`.then(() => undefined))
    const started = Date.now()
    const referenceDate = archive.referenceDate ?? '2025-10-01'
    const result = await importRelease(withPlatform, {
      register: BEV_ADDRESS_REGISTER,
      referenceDate,
      attribution: bevAttribution(referenceDate),
      sourceUrl: null,
      entries: all,
    })
    process.stdout.write(`imported ${result.entryCount} addresses in ${((Date.now() - started) / 1000).toFixed(0)} s\n`)
  }, 1_800_000)

  afterAll(async () => {
    await raw?.end()
  })

  it('resolves 200 register addresses typed seven ways', async () => {
    const misses: string[] = []
    const report: Record<string, { verified: number; right: number; ambiguous: number; none: number; ms: number[] }> = {}
    for (const [way, type] of Object.entries(WAYS)) {
      const tally = { verified: 0, right: 0, ambiguous: 0, none: 0, ms: [] as number[] }
      for (const address of sample) {
        const started = performance.now()
        const resolution = await service.resolveSite({ organizationId: ORG }, type(address))
        tally.ms.push(performance.now() - started)
        if (resolution.status === 'verified') {
          tally.verified += 1
          if (resolution.site.addressId === `at-bev:${address.addressId}`) tally.right += 1
        } else if (resolution.reason === 'ambiguous' || resolution.reason === 'multi_leaf') tally.ambiguous += 1
        else {
          tally.none += 1
          if (way === 'canonical') misses.push(`${resolution.reason}: ${type(address)}`)
        }
      }
      report[way] = tally
    }
    const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.floor(q * (values.length - 1))]
    const header = 'way'.padEnd(20) + 'verified  right  ambiguous  none   p50 ms  p95 ms'
    const lines = Object.entries(report).map(
      ([way, tally]) =>
        `${way.padEnd(20)}${String(tally.verified).padStart(8)}${String(tally.right).padStart(7)}${String(tally.ambiguous).padStart(11)}` +
        `${String(tally.none).padStart(6)}${quantile(tally.ms, 0.5).toFixed(1).padStart(9)}${quantile(tally.ms, 0.95).toFixed(1).padStart(8)}`,
    )
    process.stdout.write(`${header}\n${lines.join('\n')}\n`)
    process.stdout.write(`canonical misses: ${misses.length}\n${misses.join('\n')}\n`)
    // A verified site is always the typed address: never a neighbour, never a guess.
    for (const [way, tally] of Object.entries(report)) expect(tally.right, way).toBe(tally.verified)
    // An address the register does not hold is never verified.
    expect(report.absent_number.verified).toBe(0)
    // A street and number alone are never verified, however unique (invariant A1).
    expect(report.street_only.verified).toBe(0)
    // Typed in full, nearly every register address is found.
    expect(report.canonical.verified).toBeGreaterThanOrEqual(SAMPLE * 0.95)
  }, 600_000)
})
