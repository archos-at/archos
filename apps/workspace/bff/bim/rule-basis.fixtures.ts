import type { ContextUse, KnowledgeContext } from '@/lib/base-knowledge/context/wire'
import type { GateState } from '@/lib/base-knowledge/wire/vocab'
import type { RuleBasis } from './rule-basis'
import { BIM_RULES } from './rules'

export const SETTLED_BASES: Readonly<Record<string, RuleBasis>> = Object.fromEntries(
  BIM_RULES.map((rule) => [rule.id, { kind: 'verdict' } satisfies RuleBasis]),
)

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
    issuer: null,
    ...overrides,
  }
}

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

export const settledContext = (): KnowledgeContext =>
  contextAt('AT-9', 'core', BIM_RULES.map((rule) => contextUse(rule.designation, rule.edition)))
