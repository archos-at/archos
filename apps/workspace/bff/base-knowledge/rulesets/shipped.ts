/**
 * The setup records compiled into the build (ADR-0169): each country's setup
 * facts and classification as ruleset records, the same records a change
 * request carries (`configs/knowledge-packs/at-setup.json`), parsed by the same
 * wire and selected by the same walk up the territory chain.
 *
 * They are the fallback only. Every reader reads the released records first
 * (`readSetupRecords`); a seed answers for a country and purpose that has no
 * released record of that purpose, so an office whose country is not published
 * on its environment yet is asked, derived and placed exactly as before.
 *
 * Only Austria ships. A German or Swiss project finds no record and is asked,
 * derived and requested nothing country-specific: no Austrian option stands in.
 */

import classification from './seeds/at-oib-2023-building-class.json'
import factDefinitions from './seeds/at-setup-fact-definitions.json'
import factSources from './seeds/at-setup-fact-sources.json'
import { rulesetValuesSchema } from '@/lib/base-knowledge/wire/ruleset'
import type { StoredRuleset } from './select'

const shipped = (id: string, seed: unknown): StoredRuleset => ({
  id: `shipped:${id}`,
  values: rulesetValuesSchema.parse(seed),
})

/** Every shipped record: a seed that does not parse fails the boot, never a project's setup. */
export const SHIPPED_SETUP_RECORDS: readonly StoredRuleset[] = [
  shipped('at-oib-2023-building-class', classification),
  shipped('at-setup-fact-definitions', factDefinitions),
  shipped('at-setup-fact-sources', factSources),
]

/** The countries a record is for: `AT` for `AT`, `AT-9` and `AT:gkz:90001`. */
const countriesOf = ({ values }: StoredRuleset) => new Set(values.territoryIds.map((id) => id.slice(0, 2)))

/**
 * The released records, and a shipped record for each country and purpose no
 * released record covers. Pure.
 */
export function withShippedFallback(
  released: readonly StoredRuleset[],
  seeds: readonly StoredRuleset[] = SHIPPED_SETUP_RECORDS
): StoredRuleset[] {
  // Fallback to the compiled seed until Austria is on stable on prod; deleted by #1630.
  const covered = (seed: StoredRuleset) =>
    released.some(
      (record) => record.values.purpose === seed.values.purpose && [...countriesOf(seed)].some((country) => countriesOf(record).has(country))
    )
  return [...released, ...seeds.filter((seed) => !covered(seed))]
}
