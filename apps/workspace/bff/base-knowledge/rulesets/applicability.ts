/**
 * Whether an edition applies to a project's buildings (ADR-0178): the
 * edition's own scope table (`appliesWhen`, a boolean `decision_table.v1`),
 * run on the one evaluator once per building. Pure.
 *
 * Per building the table answers true (within the scope), false (outside it)
 * or undetermined (a fact it waits for is open, or the case is left to a
 * person by an undetermined `otherwise`). For the project the strongest answer
 * any building gives counts: the edition applies when it applies to one
 * building, is to check when no building is known to need it but one is open,
 * and is not applicable only when it is false for every building. A project
 * with no building yet is one building whose facts are all open. A table the
 * evaluator cannot run is a data error and reads `check`, never a guess.
 *
 * No work and no country is named here: OIB-RL 2.1 narrowed to a Betriebsbau
 * is a scope on Austria's records, not code.
 */

import type { UseApplicability } from '@/lib/base-knowledge/wire/project-law'
import type { AppliesWhenTable } from '@/lib/base-knowledge/wire/applies-when'
import type { FactDefinition } from '@/lib/base-knowledge/wire/setup-facts'
import type { ApplicabilityVerdict } from '@/lib/base-knowledge/wire/vocab'
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { buildingClassFacts } from './building-class'
import { evaluateDecisionTable } from './decision-table'
import { RulesetEvaluationError } from './expression'

/** One building's stored answers, by fact key (the profile's `<key>@<buildingId>`, read without the suffix). */
export interface BuildingInputs {
  buildingId: string
  inputs: Readonly<Record<string, ProjectPrimitiveValue | undefined>>
}

/** The project's buildings, and how the country reads each fact off the profile. */
export interface BuildingScope {
  buildings: readonly BuildingInputs[]
  definitions?: readonly FactDefinition[]
}

export type Applicability = UseApplicability

const STRENGTH: Record<ApplicabilityVerdict, number> = { applies: 2, check: 1, not_applicable: 0 }

/** The declared inputs a condition reads (`{"var": "uses"}`), never an element's own `var ""`. */
function factsReadBy(condition: unknown, declared: ReadonlySet<string>, into: Set<string>): Set<string> {
  if (Array.isArray(condition)) {
    for (const part of condition) factsReadBy(part, declared, into)
  } else if (condition && typeof condition === 'object') {
    for (const [operator, argument] of Object.entries(condition)) {
      if (operator === 'var' && typeof argument === 'string' && declared.has(argument)) into.add(argument)
      else factsReadBy(argument, declared, into)
    }
  }
  return into
}

const inInputOrder = (table: AppliesWhenTable, keys: ReadonlySet<string>): string[] =>
  table.inputs.map((input) => input.key).filter((key) => keys.has(key))

interface BuildingAnswer {
  verdict: ApplicabilityVerdict
  basis: Set<string>
  open: Set<string>
  provision: string | null
}

function answerFor(table: AppliesWhenTable, building: BuildingInputs, definitions: readonly FactDefinition[]): BuildingAnswer {
  const result = evaluateDecisionTable(table, buildingClassFacts(table, building.inputs, definitions))
  if (result.status === 'undetermined') {
    const open = result.reason === 'unknown_inputs' ? result.unknownInputs : []
    return { verdict: 'check', basis: new Set(), open: new Set(open), provision: null }
  }
  const declared = new Set(table.inputs.map((input) => input.key))
  const row = result.rowId === null ? null : table.rows.find((candidate) => candidate.id === result.rowId)
  return {
    verdict: result.then === true ? 'applies' : 'not_applicable',
    basis: row ? factsReadBy(row.when, declared, new Set()) : new Set(),
    open: new Set(),
    provision: result.provision?.citation ?? null,
  }
}

/** Whether an edition with scope `table` applies to the project's buildings. */
export function applicabilityOf(table: AppliesWhenTable, scope: BuildingScope): Applicability {
  const buildings = scope.buildings.length > 0 ? scope.buildings : [{ buildingId: '', inputs: {} }]
  let answers: BuildingAnswer[]
  try {
    answers = buildings.map((building) => answerFor(table, building, scope.definitions ?? []))
  } catch (error) {
    if (!(error instanceof RulesetEvaluationError)) throw error
    return { verdict: 'check', basis: [], open: [], provision: null }
  }
  const strongest = Math.max(...answers.map((answer) => STRENGTH[answer.verdict]))
  const deciding = answers.filter((answer) => STRENGTH[answer.verdict] === strongest)
  const union = (pick: (answer: BuildingAnswer) => ReadonlySet<string>) =>
    inInputOrder(table, new Set(deciding.flatMap((answer) => [...pick(answer)])))
  return {
    verdict: deciding[0].verdict,
    basis: union((answer) => answer.basis),
    open: union((answer) => answer.open),
    provision: deciding.find((answer) => answer.provision)?.provision ?? null,
  }
}
