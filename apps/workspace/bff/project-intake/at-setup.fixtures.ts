import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rulesetValuesSchema, type RulesetValues } from '@/lib/base-knowledge/wire/ruleset'
import { siteReferenceOf } from '@/lib/site-resolution/registers'
import { subdivisionTerritories } from './setup-scope'
import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'

const pack: { records: Array<{ key: string; values: unknown }> } = JSON.parse(
  readFileSync(join(process.cwd(), '..', '..', 'configs', 'knowledge-packs', 'at-setup.json'), 'utf8')
)

export const AT_SETUP_VALUES: Readonly<Record<string, RulesetValues>> = Object.fromEntries(
  pack.records.map((record) => [record.key, rulesetValuesSchema.parse(record.values)])
)

export const AT_SETUP_RECORDS: readonly StoredRuleset[] = Object.entries(AT_SETUP_VALUES).map(([key, values]) => ({
  id: `ruleset:${key}`,
  values,
}))

export const AT_SUBDIVISIONS = subdivisionTerritories(AT_SETUP_RECORDS, '2026-11-10')

export const AT_SITE_REFERENCE = siteReferenceOf(AT_SETUP_RECORDS, '2026-11-10')
export const BEV_ADDRESS_REGISTER = AT_SITE_REFERENCE.registers['at-bev']

export const AT_BUILDING_CLASS_VALUES = AT_SETUP_VALUES['at-oib-2023-building-class']
export const AT_FACT_DEFINITIONS_VALUES = AT_SETUP_VALUES['at-setup-fact-definitions']
export const AT_FACT_SOURCES_VALUES = AT_SETUP_VALUES['at-setup-fact-sources']
