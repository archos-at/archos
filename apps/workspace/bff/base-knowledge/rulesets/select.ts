/**
 * Which ruleset decides for a site (ADR-0166, design §3.6 and §3.7). Pure: the
 * caller hands in the rulesets in force and the site's territory chain, leaf
 * first (`DE:…:berlin-mitte`, `DE-BE`, `DE`); the territory records that build
 * the chain are another slice's.
 *
 * Two ways up the chain, by purpose:
 * - `nearest`: the deepest node with a ruleset decides (classification,
 *   competence, derivation). A municipality without its own competence rule is
 *   decided by its Land's.
 * - `explicit`: a node decides for itself or says `inherits: parent`
 *   (reference dates: BauGB and BayBO each pick their own Stichtag, so a node
 *   silently borrowing its parent's would be a wrong date, not a missing one).
 *
 * Either way, no ruleset is `no_rule`: a classification, an authority or a date
 * the data does not give is undetermined, and no code default stands in. Two
 * rulesets for one node, purpose and date are a data error, refused as
 * `ambiguous` rather than resolved by whichever row the database returned first.
 */

import type { DecisionTable, RulesetValues } from '@/lib/base-knowledge/wire/ruleset'
import type { RulesetPurpose } from '@/lib/base-knowledge/wire/vocab'
import { evaluateDecisionTable, type TableResult } from './decision-table'
import type { Facts } from './expression'

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
}

export interface RulesetQuery {
  purpose: RulesetPurpose
  /** The site's territories, leaf first; for `explicit` purposes, the legislating node first. */
  chain: readonly string[]
  /** The date the rule must be valid on (ISO); today in the node's zone for competence. */
  on: string
  /** A work-targeted ruleset (`workIds`) is preferred for its works; otherwise only general ones apply. */
  workId?: string
}

export type Selection =
  | { status: 'found'; ruleset: StoredRuleset; table: DecisionTable; territoryId: string }
  | { status: 'no_rule' }
  | { status: 'ambiguous'; territoryId: string; rulesetIds: string[] }

function validOn(values: RulesetValues, on: string): boolean {
  return values.validFrom <= on && (values.validTo === null || on < values.validTo)
}

/** The rulesets that speak for one node: work-targeted ones first when they exist. */
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

export function selectRuleset(rulesets: readonly StoredRuleset[], query: RulesetQuery): Selection {
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
    if (ruleset?.values.body.kind === 'table')
      return { status: 'found', ruleset, table: ruleset.values.body.payload, territoryId }
    if (!ruleset && inheritance === 'explicit') return { status: 'no_rule' }
  }
  return { status: 'no_rule' }
}

export type RulesetResult =
  | (TableResult & { rulesetId: string; territoryId: string })
  | { status: 'undetermined'; reason: 'no_rule' }
  | { status: 'undetermined'; reason: 'ambiguous_rules'; territoryId: string; rulesetIds: string[] }

/** Select the ruleset for `query` and evaluate it on `facts`: the one entry point a consumer calls. */
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
