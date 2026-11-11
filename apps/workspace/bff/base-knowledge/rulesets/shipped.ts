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

const inForce = ({ values }: StoredRuleset, on: string) => values.validFrom <= on && (values.validTo === null || on < values.validTo)

/** A released record for the seed's own node and purpose: the one the selection would find beside it. */
const sameNode = (record: StoredRuleset, seed: StoredRuleset) =>
  record.values.purpose === seed.values.purpose && record.values.territoryIds.some((id) => seed.values.territoryIds.includes(id))

/**
 * The released records, and each shipped record whose node and purpose no
 * released record holds on `on` (a released `AT-9` record leaves the `AT` seed
 * in place; a record released for a later day ends the seed that day). Pure.
 */
export function withShippedFallback(
  released: readonly StoredRuleset[],
  on: string = new Date().toISOString().slice(0, 10),
  seeds: readonly StoredRuleset[] = SHIPPED_SETUP_RECORDS
): StoredRuleset[] {
  // Fallback to the compiled seed until Austria is on stable on prod; deleted by #1630.
  const kept = seeds.flatMap((seed) => {
    const same = released.filter((record) => sameNode(record, seed))
    if (same.some((record) => inForce(record, on))) return []
    const next = same.map((record) => record.values.validFrom).filter((from) => from > on).sort()[0]
    return [next ? { ...seed, values: { ...seed.values, validTo: next } } : seed]
  })
  return [...released, ...kept]
}
