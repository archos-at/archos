/**
 * The records the setup reads today (ADR-0169): each country's setup facts
 * and classification as ruleset records, shipped with the build until Austria
 * is published as the platform's first pack (S8). They are the same records a
 * change request carries (migration 0206 makes their bodies storable), parsed
 * by the same wire, and selected by the same walk up the territory chain, so
 * moving them into the database changes where they are read, not what they say.
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
