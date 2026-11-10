/**
 * Whether a work applies to a project's buildings (ADR-0176): the work's
 * `applicability` table, selected on the site's chain like any decision
 * table, run on the one evaluator once per building. Pure.
 *
 * The answer for the project is the strongest any building gives: a work
 * applies when it applies to one building, is to check when no building is
 * known to need it but one is open, and is not applicable only when the table
 * excludes it for every building. A project with no building yet is one
 * building whose facts are all open, so it reads `check` with every fact the
 * table waits for. A work no table speaks for is not narrowed (`null`); two
 * tables for one node are a data error and read `check`, never a guess.
 *
 * No work and no country is named here: OIB-RL 2.1 narrowed to a Betriebsbau
 * is a record in Austria's pack, not code.
 */

import type { DecisionTable } from '@/lib/base-knowledge/wire/ruleset'
import type { FactDefinition } from '@/lib/base-knowledge/wire/setup-facts'
import type { ApplicabilityVerdict } from '@/lib/base-knowledge/wire/vocab'
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { buildingClassFacts } from './building-class'
import { evaluateDecisionTable } from './decision-table'
import { selectRuleset, type StoredRuleset } from './select'

/** One building's stored answers, by fact key (the profile's `<key>@<buildingId>`, read without the suffix). */
export interface BuildingInputs {
  buildingId: string
  inputs: Readonly<Record<string, ProjectPrimitiveValue | undefined>>
}

export interface Applicability {
  verdict: ApplicabilityVerdict
  /** The facts the deciding rows read, in the table's input order: why it applies or does not. */
  basis: string[]
  /** For `check`: the facts whose answer would decide it, in the table's input order. */
  open: string[]
  /** The provision the deciding row cites, when it cites one. */
  provision: string | null
  /** The ruleset that decided, for the record the answer rests on. */
  rulesetId: string
}

export interface ApplicabilityQuery {
  chain: readonly string[]
  on: string
  /** The project's buildings; none is read as one building nobody described yet. */
  buildings: readonly BuildingInputs[]
  /** The country's fact definitions: how each input is read off the profile. */
  definitions?: readonly FactDefinition[]
}

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

const inInputOrder = (table: DecisionTable, keys: ReadonlySet<string>): string[] =>
  table.inputs.map((input) => input.key).filter((key) => keys.has(key))

interface BuildingAnswer {
  verdict: ApplicabilityVerdict
  basis: Set<string>
  open: Set<string>
  provision: string | null
}

function answerFor(table: DecisionTable, building: BuildingInputs, definitions: readonly FactDefinition[]): BuildingAnswer {
  const result = evaluateDecisionTable(table, buildingClassFacts(table, building.inputs, definitions))
  if (result.status === 'undetermined') {
    const open = result.reason === 'unknown_inputs' ? result.unknownInputs : []
    return { verdict: 'check', basis: new Set(), open: new Set(open), provision: null }
  }
  const declared = new Set(table.inputs.map((input) => input.key))
  const row = result.rowId === null ? null : table.rows.find((candidate) => candidate.id === result.rowId)
  return {
    verdict: result.then as ApplicabilityVerdict,
    basis: row ? factsReadBy(row.when, declared, new Set()) : new Set(),
    open: new Set(),
    provision: result.provision?.citation ?? null,
  }
}

/** Whether `workId` applies to the project's buildings; `null` where no table speaks for it. */
export function applicabilityOf(
  rulesets: readonly StoredRuleset[],
  workId: string,
  query: ApplicabilityQuery
): Applicability | null {
  const selection = selectRuleset(rulesets, { purpose: 'applicability', chain: query.chain, on: query.on, workId })
  if (selection.status === 'no_rule') return null
  if (selection.status === 'ambiguous') {
    return { verdict: 'check', basis: [], open: [], provision: null, rulesetId: selection.rulesetIds.join(',') }
  }
  const { table } = selection
  const buildings = query.buildings.length > 0 ? query.buildings : [{ buildingId: '', inputs: {} }]
  const answers = buildings.map((building) => answerFor(table, building, query.definitions ?? []))
  const strongest = Math.max(...answers.map((answer) => STRENGTH[answer.verdict]))
  const deciding = answers.filter((answer) => STRENGTH[answer.verdict] === strongest)
  const union = (pick: (answer: BuildingAnswer) => ReadonlySet<string>) =>
    inInputOrder(table, new Set(deciding.flatMap((answer) => [...pick(answer)])))
  return {
    verdict: deciding[0].verdict,
    basis: union((answer) => answer.basis),
    open: union((answer) => answer.open),
    provision: deciding.find((answer) => answer.provision)?.provision ?? null,
    rulesetId: selection.ruleset.id,
  }
}
