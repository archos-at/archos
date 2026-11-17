import type { DecisionTable } from '@/lib/base-knowledge/wire/ruleset'
import type { DerivationDefinition, FactDefinition } from '@/lib/base-knowledge/wire/setup-facts'
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { evaluateDecisionTable, type Candidate } from './decision-table'
import type { Facts } from './expression'

export type BuildingClassInputs = Readonly<Record<string, ProjectPrimitiveValue | undefined>>

export interface BuildingClassResult {
  value: number | null
  hochhaus: boolean
  applicable: boolean
  missing: string[]
}

function readNumber(raw: ProjectPrimitiveValue | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function readBoolean(raw: ProjectPrimitiveValue | undefined): boolean | null {
  if (typeof raw === 'boolean') return raw
  if (raw === 'yes') return true
  if (raw === 'no') return false
  return null
}

function readCode(raw: ProjectPrimitiveValue | undefined, codes: readonly string[] | undefined): string | null {
  if (typeof raw !== 'string' || raw === '') return null
  return !codes || codes.includes(raw) ? raw : null
}

function readCodes(raw: ProjectPrimitiveValue | undefined): string[] | null {
  const values: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' && raw !== '' ? [raw] : []
  if (values.length === 0 || !values.every((value): value is string => typeof value === 'string')) return null
  return values
}

function readDate(raw: ProjectPrimitiveValue | undefined): string | null {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}

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

function meaningOf(then: unknown, derivation: DerivationDefinition): Omit<BuildingClassResult, 'missing'> {
  const code = String(then)
  if (derivation.notApplicable !== undefined && code === derivation.notApplicable)
    return { value: null, hochhaus: false, applicable: false }
  if (derivation.highRise !== undefined && code === derivation.highRise)
    return { value: null, hochhaus: true, applicable: true }
  return { value: derivation.values[code] ?? null, hochhaus: false, applicable: true }
}

export function candidateMeanings(candidates: readonly Candidate[], derivation: DerivationDefinition) {
  return candidates.map((candidate) => ({ rowId: candidate.rowId, ...meaningOf(candidate.then, derivation) }))
}

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
