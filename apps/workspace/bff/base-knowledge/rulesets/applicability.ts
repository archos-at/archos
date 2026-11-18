import type { UseApplicability } from '@/lib/base-knowledge/wire/project-law'
import type { AppliesWhenTable } from '@/lib/base-knowledge/wire/applies-when'
import type { FactDefinition } from '@/lib/base-knowledge/wire/setup-facts'
import type { ApplicabilityVerdict } from '@/lib/base-knowledge/wire/vocab'
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { buildingClassFacts } from './building-class'
import { evaluateDecisionTable } from './decision-table'
import { RulesetEvaluationError } from './expression'

export interface BuildingInputs {
  buildingId: string
  inputs: Readonly<Record<string, ProjectPrimitiveValue | undefined>>
}

export interface BuildingScope {
  buildings: readonly BuildingInputs[]
  definitions?: readonly FactDefinition[]
}

export type Applicability = UseApplicability

const STRENGTH: Record<ApplicabilityVerdict, number> = { applies: 2, check: 1, not_applicable: 0 }

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
