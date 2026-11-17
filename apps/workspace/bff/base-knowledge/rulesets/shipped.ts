import classification from './seeds/at-oib-2023-building-class.json'
import factDefinitions from './seeds/at-setup-fact-definitions.json'
import factSources from './seeds/at-setup-fact-sources.json'
import { rulesetValuesSchema } from '@/lib/base-knowledge/wire/ruleset'
import type { StoredRuleset } from './select'

const shipped = (id: string, seed: unknown): StoredRuleset => ({
  id: `shipped:${id}`,
  values: rulesetValuesSchema.parse(seed),
})

export const SHIPPED_SETUP_RECORDS: readonly StoredRuleset[] = [
  shipped('at-oib-2023-building-class', classification),
  shipped('at-setup-fact-definitions', factDefinitions),
  shipped('at-setup-fact-sources', factSources),
]

const inForce = ({ values }: StoredRuleset, on: string) => values.validFrom <= on && (values.validTo === null || on < values.validTo)

const sameNode = (record: StoredRuleset, seed: StoredRuleset) =>
  record.values.purpose === seed.values.purpose && record.values.territoryIds.some((id) => seed.values.territoryIds.includes(id))

export function withShippedFallback(
  released: readonly StoredRuleset[],
  on: string = new Date().toISOString().slice(0, 10),
  seeds: readonly StoredRuleset[] = SHIPPED_SETUP_RECORDS
): StoredRuleset[] {
  const kept = seeds.flatMap((seed) => {
    const same = released.filter((record) => sameNode(record, seed))
    if (same.some((record) => inForce(record, on))) return []
    const next = same.map((record) => record.values.validFrom).filter((from) => from > on).sort()[0]
    return [next ? { ...seed, values: { ...seed.values, validTo: next } } : seed]
  })
  return [...released, ...kept]
}
