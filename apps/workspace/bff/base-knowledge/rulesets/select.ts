import type { DecisionTable, RulesetValues } from '@/lib/base-knowledge/wire/ruleset'
import type { RulesetPurpose } from '@/lib/base-knowledge/wire/vocab'
import { evaluateDecisionTable, type TableResult } from './decision-table'
import { RulesetEvaluationError, type Facts } from './expression'

export interface StoredRuleset {
  id: string
  values: RulesetValues
}

export const INHERITANCE_BY_PURPOSE: Record<RulesetPurpose, 'nearest' | 'explicit'> = {
  classification: 'nearest',
  derivation: 'nearest',
  competence: 'nearest',
  reference_date: 'explicit',
  fact_definitions: 'nearest',
  fact_sources: 'nearest',
  advice_policy: 'nearest',
  terminology: 'nearest',
  citation_style: 'nearest',
}

export interface RulesetQuery {
  purpose: RulesetPurpose
  chain: readonly string[]
  on: string
  workId?: string
}

export type Selection =
  | { status: 'found'; ruleset: StoredRuleset; table: DecisionTable; territoryId: string }
  | { status: 'no_rule' }
  | { status: 'ambiguous'; territoryId: string; rulesetIds: string[] }

function validOn(values: RulesetValues, on: string): boolean {
  return values.validFrom <= on && (values.validTo === null || on < values.validTo)
}

function atNode(
  rulesets: readonly StoredRuleset[],
  query: RulesetQuery,
  territoryId: string
): StoredRuleset[] {
  const here = rulesets.filter(
    ({ values }) =>
      values.purpose === query.purpose &&
      values.territoryIds.includes(territoryId) &&
      validOn(values, query.on)
  )
  const targeted = query.workId
    ? here.filter(({ values }) => values.workIds.includes(query.workId as string))
    : []
  return targeted.length > 0 ? targeted : here.filter(({ values }) => values.workIds.length === 0)
}

export function selectRecord(rulesets: readonly StoredRuleset[], query: RulesetQuery): RecordSelection {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query.on))
    throw new RulesetEvaluationError(`on is an ISO date, found ${query.on}`)
  const inheritance = INHERITANCE_BY_PURPOSE[query.purpose]
  for (const territoryId of query.chain) {
    const found = atNode(rulesets, query, territoryId)
    if (found.length > 1)
      return {
        status: 'ambiguous',
        territoryId,
        rulesetIds: found.map((ruleset) => ruleset.id).sort(),
      }
    const [ruleset] = found
    if (ruleset && ruleset.values.body.kind !== 'inherits') return { status: 'found', ruleset, territoryId }
    if (!ruleset && inheritance === 'explicit') return { status: 'no_rule' }
  }
  return { status: 'no_rule' }
}

export type RecordSelection =
  | { status: 'found'; ruleset: StoredRuleset; territoryId: string }
  | { status: 'no_rule' }
  | { status: 'ambiguous'; territoryId: string; rulesetIds: string[] }

export function selectRuleset(rulesets: readonly StoredRuleset[], query: RulesetQuery): Selection {
  const selection = selectRecord(rulesets, query)
  if (selection.status !== 'found') return selection
  const { body } = selection.ruleset.values
  if (body.kind !== 'table') return { status: 'no_rule' }
  return { ...selection, table: body.payload }
}

export type RulesetResult =
  | (TableResult & { rulesetId: string; territoryId: string })
  | { status: 'undetermined'; reason: 'no_rule' }
  | { status: 'undetermined'; reason: 'ambiguous_rules'; territoryId: string; rulesetIds: string[] }

export function decide(
  rulesets: readonly StoredRuleset[],
  query: RulesetQuery,
  facts: Facts
): RulesetResult {
  const selection = selectRuleset(rulesets, query)
  if (selection.status === 'no_rule') return { status: 'undetermined', reason: 'no_rule' }
  if (selection.status === 'ambiguous') {
    return {
      status: 'undetermined',
      reason: 'ambiguous_rules',
      territoryId: selection.territoryId,
      rulesetIds: selection.rulesetIds,
    }
  }
  return {
    ...evaluateDecisionTable(selection.table, facts),
    rulesetId: selection.ruleset.id,
    territoryId: selection.territoryId,
  }
}
