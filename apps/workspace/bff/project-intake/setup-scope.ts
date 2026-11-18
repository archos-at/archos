import { selectRecord, selectRuleset, type StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import { SHIPPED_SETUP_RECORDS } from '@/lib/base-knowledge/rulesets/shipped'
import type { DecisionTable } from '@/lib/base-knowledge/wire/ruleset'
import type { AddressRegisterRecord, DerivationDefinition, FactDefinitions, FactSources } from '@/lib/base-knowledge/wire/setup-facts'
import { siteCountry } from '@/lib/project-profile/site'
import type { ProjectProfile } from '@/lib/project-profile/types'

export interface SetupScope {
  chain: readonly string[]
  on: string
  records: readonly StoredRuleset[]
}

export interface SetupScopeOptions {
  location?: { federalState: string | null } | null
  records: readonly StoredRuleset[]
  on?: string
  lawWithheld?: boolean
}

const today = () => new Date().toISOString().slice(0, 10)

function stringOf(entry: { value: unknown } | undefined): string | null {
  return typeof entry?.value === 'string' && entry.value.trim() ? entry.value.trim() : null
}

function definitionsAt(records: readonly StoredRuleset[], chain: readonly string[], on: string): FactDefinitions | null {
  const selection = selectRecord(records, { purpose: 'fact_definitions', chain, on })
  if (selection.status !== 'found') return null
  const { body } = selection.ruleset.values
  return body.kind === 'fact_definitions' ? body.payload : null
}

function countryOfSubdivision(records: readonly StoredRuleset[], token: string, on: string): string | null {
  const countries = new Set<string>()
  for (const { values } of records) {
    if (values.body.kind !== 'fact_definitions') continue
    if (values.validFrom > on || (values.validTo !== null && on >= values.validTo)) continue
    if (values.body.payload.subdivisions?.options.some((option) => option.token === token))
      for (const territoryId of values.territoryIds) if (/^[A-Z]{2}$/.test(territoryId)) countries.add(territoryId)
  }
  return countries.size === 1 ? [...countries][0] : null
}

export function setupScopeOf(
  profile: Pick<ProjectProfile, 'facts' | 'assumptions'>,
  options: SetupScopeOptions
): SetupScope {
  const { records } = options
  const on = options.on ?? today()
  const located = options.location?.federalState ?? null
  const site = siteCountry(profile)
  const country =
    site && site !== 'other' ? site.toUpperCase() : site === null && located ? countryOfSubdivision(records, located, on) : null
  if (!country || !/^[A-Z]{2}$/.test(country)) return { chain: [], on, records }
  const subdivisions = definitionsAt(records, [country], on)?.subdivisions
  if (!subdivisions) return { chain: [country], on, records }
  const stated =
    stringOf(profile.facts[subdivisions.factKey]) ?? stringOf(profile.assumptions[subdivisions.factKey]) ?? located
  if (subdivisions.outside && stated === subdivisions.outside.token) return { chain: [], on, records }
  const subdivision = subdivisions.options.find((option) => option.token === stated)
  return { chain: subdivision ? [subdivision.territoryId, country] : [country], on, records }
}

export function factDefinitionsOf(scope: SetupScope): FactDefinitions | null {
  return scope.chain.length === 0 ? null : definitionsAt(scope.records, scope.chain, scope.on)
}

export function factSourcesOf(scope: SetupScope): FactSources | null {
  if (scope.chain.length === 0) return null
  const selection = selectRecord(scope.records, { purpose: 'fact_sources', chain: scope.chain, on: scope.on })
  if (selection.status !== 'found') return null
  const { body } = selection.ruleset.values
  return body.kind === 'fact_sources' ? body.payload : null
}

export const BUILDING_CLASS_RULE = 'building_class'

export interface BuildingClassification {
  table: DecisionTable
  derivation: DerivationDefinition
  definitions: FactDefinitions
  rulesetId: string
  territoryId: string
}

export function buildingClassificationOf(scope: SetupScope): BuildingClassification | null {
  if (scope.chain.length === 0) return null
  const selection = selectRuleset(scope.records, { purpose: 'classification', chain: scope.chain, on: scope.on })
  const definitions = factDefinitionsOf(scope)
  const derivation = definitions?.derivations.find((entry) => entry.rule === BUILDING_CLASS_RULE)
  if (selection.status !== 'found' || !definitions || !derivation) return null
  return {
    table: selection.table,
    derivation,
    definitions,
    rulesetId: selection.ruleset.id,
    territoryId: selection.territoryId,
  }
}

export const classificationInputs = (classification: BuildingClassification | null): string[] =>
  classification ? classification.table.inputs.map((input) => input.key) : []

const inForce = (values: { validFrom: string; validTo: string | null }, on: string) =>
  values.validFrom <= on && (values.validTo === null || on < values.validTo)

function definitionsInForce(records: readonly StoredRuleset[], on: string): Array<{ countries: string[]; payload: FactDefinitions }> {
  return records.flatMap(({ values }) =>
    values.body.kind === 'fact_definitions' && inForce(values, on)
      ? [{ countries: values.territoryIds.filter((id) => /^[A-Z]{2}$/.test(id)), payload: values.body.payload }]
      : []
  )
}

export function subdivisionTerritories(records: readonly StoredRuleset[], on: string = today()): Readonly<Record<string, string>> {
  const found = new Map<string, string | null>()
  for (const { payload } of definitionsInForce(records, on))
    for (const option of payload.subdivisions?.options ?? []) {
      const known = found.get(option.token)
      found.set(option.token, known === undefined || known === option.territoryId ? option.territoryId : null)
    }
  return Object.fromEntries([...found].filter((entry): entry is [string, string] => entry[1] !== null))
}

export interface AssumedSubdivision {
  factKey: string
  token: string
  territoryId: string
}

export function assumedSubdivisionOf(
  records: readonly StoredRuleset[],
  homeCountry: string | null,
  on: string = today(),
  fallback: readonly StoredRuleset[] = SHIPPED_SETUP_RECORDS
): AssumedSubdivision | null {
  if (!homeCountry || !/^[A-Z]{2}$/.test(homeCountry)) return null
  const subdivisions = definitionsAt(records, [homeCountry], on)?.subdivisions
  const token = subdivisions?.assumedWhenUnstated ?? definitionsAt(fallback, [homeCountry], on)?.subdivisions?.assumedWhenUnstated
  const option = token ? subdivisions?.options.find((entry) => entry.token === token) : undefined
  return subdivisions && option ? { factKey: subdivisions.factKey, token: option.token, territoryId: option.territoryId } : null
}

export function subdivisionLabels(records: readonly StoredRuleset[], on: string = today()): Readonly<Record<string, string>> {
  return Object.fromEntries(
    definitionsInForce(records, on).flatMap(({ payload }) => (payload.subdivisions?.options ?? []).map((option) => [option.territoryId, option.label]))
  )
}

export function addressRegistersOf(
  records: readonly StoredRuleset[],
  on: string = today()
): Array<{ country: string; register: AddressRegisterRecord }> {
  return definitionsInForce(records, on).flatMap(({ countries, payload }) =>
    payload.addressRegister && countries.length === 1 ? [{ country: countries[0], register: payload.addressRegister }] : []
  )
}

export function hasSetupRecords(records: readonly StoredRuleset[], country: string, on: string = today()): boolean {
  return definitionsInForce(records, on).some(({ countries }) => countries.includes(country))
}

export function setupUnpublished(
  profile: Pick<ProjectProfile, 'facts' | 'assumptions'>,
  records: readonly StoredRuleset[],
  on?: string
): boolean {
  const { chain } = setupScopeOf(profile, { records, on })
  const country = chain.length > 0 ? chain[chain.length - 1] : null
  return country ? !hasSetupRecords(records, country, on) : records.length === 0
}
