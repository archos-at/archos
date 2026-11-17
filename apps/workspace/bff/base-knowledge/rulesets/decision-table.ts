import { isDeepStrictEqual } from 'node:util'
import type { DecisionTable, Provision } from '@/lib/base-knowledge/wire/ruleset'
import { evaluateExpression, scopeOf, type Facts } from './expression'

export interface Candidate {
  rowId: string | null
  then: unknown
}

export type TableResult =
  | { status: 'decided'; rowId: string | null; then: unknown; provision?: Provision }
  | {
      status: 'undetermined'
      reason: 'unknown_inputs'
      unknownInputs: string[]
      candidates: Candidate[]
    }
  | { status: 'undetermined'; reason: 'no_row_applies' }

export function evaluateDecisionTable(table: DecisionTable, facts: Facts): TableResult {
  const scope = scopeOf(table.inputs, facts)
  const waitsFor = new Set<string>()
  const candidates: Candidate[] = []
  for (const row of table.rows) {
    const holds = evaluateExpression(row.when, scope)
    if (!holds.known) {
      for (const key of holds.waitsFor) waitsFor.add(key)
      candidates.push({ rowId: row.id, then: row.then })
      continue
    }
    if (holds.value !== true) continue
    if (waitsFor.size === 0)
      return {
        status: 'decided',
        rowId: row.id,
        then: row.then,
        ...(row.provision ? { provision: row.provision } : {}),
      }
    candidates.push({ rowId: row.id, then: row.then })
    return undetermined(table, waitsFor, candidates)
  }
  const otherwise = 'then' in table.otherwise ? { rowId: null, then: table.otherwise.then } : null
  if (waitsFor.size > 0)
    return undetermined(table, waitsFor, otherwise ? [...candidates, otherwise] : candidates)
  return otherwise
    ? { status: 'decided', ...otherwise }
    : { status: 'undetermined', reason: 'no_row_applies' }
}

function undetermined(
  table: DecisionTable,
  waitsFor: ReadonlySet<string>,
  candidates: Candidate[]
): TableResult {
  const unknownInputs = table.inputs.map((input) => input.key).filter((key) => waitsFor.has(key))
  return { status: 'undetermined', reason: 'unknown_inputs', unknownInputs, candidates }
}

export interface ExampleFailure {
  index: number
  expected: unknown
  actual: TableResult
}

export function failingExamples(table: DecisionTable): ExampleFailure[] {
  return table.examples.flatMap((example, index) => {
    const actual = evaluateDecisionTable(table, example.facts)
    const passes =
      'then' in example.expect
        ? actual.status === 'decided' && isDeepStrictEqual(actual.then, example.expect.then)
        : actual.status === 'undetermined' &&
          actual.reason === 'unknown_inputs' &&
          JSON.stringify(actual.unknownInputs) === JSON.stringify(example.expect.undeterminedBy)
    return passes ? [] : [{ index, expected: example.expect, actual }]
  })
}
