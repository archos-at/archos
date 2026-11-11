/**
 * Bases and knowledge contexts for the rule catalogue's specs: every rule
 * settled, and a context with the uses a spec states.
 */

import type { ContextUse, KnowledgeContext } from '@/lib/base-knowledge/context/wire'
import type { GateState } from '@/lib/base-knowledge/wire/vocab'
import type { RuleBasis } from './rule-basis'
import { BIM_RULES } from './rules'

/** Every rule of the catalogue may give a verdict: its edition binds at a settled site. */
export const SETTLED_BASES: Readonly<Record<string, RuleBasis>> = Object.fromEntries(
  BIM_RULES.map((rule) => [rule.id, { kind: 'verdict' } satisfies RuleBasis]),
)

/** One use, binding unless stated: the designation and the label are what a basis reads. */
export function contextUse(designation: string, editionLabel: string, overrides: Partial<ContextUse> = {}): ContextUse {
  return {
    workId: `work:${designation}`,
    editionId: `edition:${designation}:${editionLabel}`,
    role: 'binding',
    qualifier: null,
    via: 'relation',
    route: null,
    roleSince: null,
    date: '2026-11-11',
    freshness: 'current',
    lastCheckedAt: null,
    connectsBy: ['site'],
    labels: [],
    corpusFiles: [],
    designation,
    editionLabel,
    sourceRefs: [],
    sourceUrl: null,
    language: null,
    textStatus: null,
    applicability: null,
    ...overrides,
  }
}

/** A context at one leaf with the given gate and uses. */
export function contextAt(territoryId: string, gate: GateState, uses: ContextUse[] = []): KnowledgeContext {
  return {
    gate: {
      state: gate,
      reason: null,
      leaves: [{ territoryId, country: territoryId.slice(0, 2), certainty: 'verified', entitled: true, coverage: null, municipalLaw: null }],
    },
    packs: [],
    chains: { [territoryId]: [territoryId] },
    date: '2026-11-11',
    procedures: [],
    uses,
    text: null,
    retrieval: { countries: [territoryId.slice(0, 2)] },
    undetermined: [],
  }
}

/** A settled site where every rule's edition binds: each rule may give a verdict. */
export const settledContext = (): KnowledgeContext =>
  contextAt('AT-9', 'core', BIM_RULES.map((rule) => contextUse(rule.designation, rule.edition)))
