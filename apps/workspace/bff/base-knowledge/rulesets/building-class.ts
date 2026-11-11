/**
 * The building class as a ruleset (ADR-0166, ADR-0169): a country's
 * classification table, run on the one evaluator, read and answered in the
 * profile's terms.
 *
 * Both directions are data. The country's `fact_definitions` say how each
 * input is read off the profile (its type, the codes a code may take), and its
 * derivation says what each answer means (a class number, the high-rise code,
 * the code for no building). No country's classes are named here: Austria's
 * OIB 2023 table is one seed among the records (`seeds/`), and a German or
 * Swiss project is classified by its own country's table or not at all.
 */

import seed from './seeds/at-oib-2023-building-class.json'
import {
  rulesetValuesSchema,
  type DecisionTable,
  type RulesetValues,
} from '@/lib/base-knowledge/wire/ruleset'
import type { DerivationDefinition, FactDefinition } from '@/lib/base-knowledge/wire/setup-facts'
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { evaluateDecisionTable, type Candidate } from './decision-table'
import type { Facts } from './expression'

export const AT_OIB_2023_BUILDING_CLASS: RulesetValues = rulesetValuesSchema.parse(seed)

/** A Building's stored answers, by the table's input keys. */
export type BuildingClassInputs = Readonly<Record<string, ProjectPrimitiveValue | undefined>>

export interface BuildingClassResult {
  /** The class, or null while an input that matters is missing, for a high-rise, or for a structure that is no building. */
  value: number | null
  /** The table answered its high-rise code: no building class. */
  hochhaus: boolean
  /** False when the structure is known to be no building: nothing is classified. */
  applicable: boolean
  /** The inputs whose value could still change the outcome, in the table's order. Empty once the outcome is known. */
  missing: string[]
}

function readNumber(raw: ProjectPrimitiveValue | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/** `true` / `false` as the profile stores a yes_no_open answer, or `yes` / `no` as the wizard holds it. `open` is unknown. */
function readBoolean(raw: ProjectPrimitiveValue | undefined): boolean | null {
  if (typeof raw === 'boolean') return raw
  if (raw === 'yes') return true
  if (raw === 'no') return false
  return null
}

/** A code: a non-empty token, and one the definition offers when it lists codes. Anything else is unknown, never a value. */
function readCode(raw: ProjectPrimitiveValue | undefined, codes: readonly string[] | undefined): string | null {
  if (typeof raw !== 'string' || raw === '') return null
  return !codes || codes.includes(raw) ? raw : null
}

/**
 * A list of codes; a single token is a list of one, and none given is unknown.
 * A list holding anything but tokens is unreadable, so unknown: the profile's
 * type allows only strings, and a guess here would be a class.
 */
function readCodes(raw: ProjectPrimitiveValue | undefined): string[] | null {
  const values: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' && raw !== '' ? [raw] : []
  if (values.length === 0 || !values.every((value): value is string => typeof value === 'string')) return null
  return values
}

function readDate(raw: ProjectPrimitiveValue | undefined): string | null {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}

/** One input as the table reads it, or `null` where the profile holds no readable answer. */
export function readFactInput(
  type: DecisionTable['inputs'][number]['type'],
  raw: ProjectPrimitiveValue | undefined,
  definition?: FactDefinition
): unknown {
  switch (type) {
    case 'number':
      return readNumber(raw)
    case 'boolean':
      return readBoolean(raw)
    case 'code':
      return readCode(raw, definition?.codes)
    case 'codes':
      return readCodes(raw)
    case 'date':
      return readDate(raw)
  }
}

/** A Building's stored answers as the table's facts, each read as its fact definition says. */
export function buildingClassFacts(
  table: DecisionTable,
  inputs: BuildingClassInputs,
  definitions: readonly FactDefinition[] = []
): Facts {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]))
  const facts: Record<string, unknown> = {}
  for (const input of table.inputs) facts[input.key] = readFactInput(input.type, inputs[input.key], byKey.get(input.key))
  return facts
}

/** What one table answer means for the profile, as the derivation defines its codes. */
function meaningOf(then: unknown, derivation: DerivationDefinition): Omit<BuildingClassResult, 'missing'> {
  const code = String(then)
  if (derivation.notApplicable !== undefined && code === derivation.notApplicable)
    return { value: null, hochhaus: false, applicable: false }
  if (derivation.highRise !== undefined && code === derivation.highRise)
    return { value: null, hochhaus: true, applicable: true }
  return { value: derivation.values[code] ?? null, hochhaus: false, applicable: true }
}

/** The answers still open, as their meanings: what a person is told the class can still turn out to be. */
export function candidateMeanings(candidates: readonly Candidate[], derivation: DerivationDefinition) {
  return candidates.map((candidate) => ({ rowId: candidate.rowId, ...meaningOf(candidate.then, derivation) }))
}

/** The building class of one Building, decided by `table` and read through `derivation`. */
export function classifyWithTable(
  table: DecisionTable,
  derivation: DerivationDefinition,
  inputs: BuildingClassInputs,
  definitions: readonly FactDefinition[] = []
): BuildingClassResult {
  const result = evaluateDecisionTable(table, buildingClassFacts(table, inputs, definitions))
  if (result.status === 'undetermined') {
    const missing = result.reason === 'unknown_inputs' ? result.unknownInputs : []
    return { value: null, hochhaus: false, applicable: true, missing }
  }
  return { ...meaningOf(result.then, derivation), missing: [] }
}
