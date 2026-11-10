/**
 * Which country's setup records speak for a project (ADR-0169, design §5.5
 * step 7): the territory chain its site gives, and the records selected on it.
 * Pure. Every per-country answer of the setup (the subdivisions, the building
 * class, the documents to request) goes through here, so a project receives
 * its own country's records and no other's.
 *
 * Fail closed: a project nothing places, or one placed in a country with no
 * records, has an empty chain or finds nothing on it, and gets no
 * country-specific option, class or request. Two records for one node and
 * purpose are a data error and also give nothing, never the first one found.
 */

import { SHIPPED_SETUP_RECORDS } from '@/lib/base-knowledge/rulesets/shipped'
import { selectRecord, selectRuleset, type StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import type { DecisionTable } from '@/lib/base-knowledge/wire/ruleset'
import type { DerivationDefinition, FactDefinitions, FactSources } from '@/lib/base-knowledge/wire/setup-facts'
import { siteCountry } from '@/lib/project-profile/site'
import type { ProjectProfile } from '@/lib/project-profile/types'

export interface SetupScope {
  /** The site's territories, leaf first (`AT-9`, `AT`); empty when nothing places the project. */
  chain: readonly string[]
  /** The date the records must be valid on (ISO). */
  on: string
  records: readonly StoredRuleset[]
}

export interface SetupScopeOptions {
  /** The geocoder's reading at creation: places the subdivision when the profile names none. */
  location?: { federalState: string | null } | null
  /** The records to select from; the shipped pack by default. */
  records?: readonly StoredRuleset[]
  /** ISO date; today by default. */
  on?: string
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

/** The country a subdivision token belongs to, by the records that list it: for a geocoded Land with no country stated. */
function countryOfSubdivision(records: readonly StoredRuleset[], token: string, on: string): string | null {
  const countries = new Set<string>()
  for (const { values } of records) {
    if (values.body.kind !== 'fact_definitions') continue
    if (values.validFrom > on || (values.validTo !== null && on >= values.validTo)) continue
    if (values.body.payload.subdivisions?.options.some((option) => option.token === token))
      for (const territoryId of values.territoryIds) if (/^[A-Z]{2}$/.test(territoryId)) countries.add(territoryId)
  }
  // A token two countries share places nothing: which one is the question.
  return countries.size === 1 ? [...countries][0] : null
}

/** The project's chain: its country and, where a record lists the stated subdivision, that subdivision first. */
export function setupScopeOf(
  profile: Pick<ProjectProfile, 'facts' | 'assumptions'>,
  options: SetupScopeOptions = {}
): SetupScope {
  const records = options.records ?? SHIPPED_SETUP_RECORDS
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

/** The rule a building's class is written under, in every country that classifies buildings. */
export const BUILDING_CLASS_RULE = 'building_class'

export interface BuildingClassification {
  table: DecisionTable
  derivation: DerivationDefinition
  definitions: FactDefinitions
  rulesetId: string
  territoryId: string
}

/**
 * The building classification for the project's site: its classification
 * table and the derivation that reads its answers. Null without either: a
 * table nobody defined the meaning of writes no class.
 */
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

/** The inputs a classification reads, in its table's order: what a change to the profile must touch to move a class. */
export const classificationInputs = (classification: BuildingClassification | null): string[] =>
  classification ? classification.table.inputs.map((input) => input.key) : []
