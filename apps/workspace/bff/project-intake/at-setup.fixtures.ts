/**
 * Austria's setup records as a spec reads them: the ruleset records of the
 * change request an operator proposes (`configs/knowledge-packs/at-setup.json`),
 * parsed by the same wire the door validates with. The build ships none of
 * them (country-as-data, step 3): a spec that needs Austria's setup hands these
 * to the readers, exactly as `readSetupRecords` hands them the released ones,
 * and one that needs a database publishes them first (`setup-records.integration.spec.ts`).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rulesetValuesSchema, type RulesetValues } from '@/lib/base-knowledge/wire/ruleset'
import { siteReferenceOf } from '@/lib/site-resolution/registers'
import { subdivisionTerritories } from './setup-scope'
import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'

/** Read at test time from the repo root: the image build has no `configs/` and no product code reads it. */
const pack: { records: Array<{ key: string; values: unknown }> } = JSON.parse(
  readFileSync(join(process.cwd(), '..', '..', 'configs', 'knowledge-packs', 'at-setup.json'), 'utf8')
)

/** The pack's records by key, as the wire's values. */
export const AT_SETUP_VALUES: Readonly<Record<string, RulesetValues>> = Object.fromEntries(
  pack.records.map((record) => [record.key, rulesetValuesSchema.parse(record.values)])
)

/** Every record of the pack, as a reader selects among them. */
export const AT_SETUP_RECORDS: readonly StoredRuleset[] = Object.entries(AT_SETUP_VALUES).map(([key, values]) => ({
  id: `ruleset:${key}`,
  values,
}))

/** The territory each Land token names, as `subdivisionTerritories` reads it from Austria's records. */
export const AT_SUBDIVISIONS = subdivisionTerritories(AT_SETUP_RECORDS, '2026-11-10')

/** Austria's address register and Länder as the resolver reads them from the records. */
export const AT_SITE_REFERENCE = siteReferenceOf(AT_SETUP_RECORDS, '2026-11-10')
export const BEV_ADDRESS_REGISTER = AT_SITE_REFERENCE.registers['at-bev']

export const AT_BUILDING_CLASS_VALUES = AT_SETUP_VALUES['at-oib-2023-building-class']
export const AT_FACT_DEFINITIONS_VALUES = AT_SETUP_VALUES['at-setup-fact-definitions']
export const AT_FACT_SOURCES_VALUES = AT_SETUP_VALUES['at-setup-fact-sources']
