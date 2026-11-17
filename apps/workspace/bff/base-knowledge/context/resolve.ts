import { chainAt, resolveChain, roleRank } from '../chain/resolve'
import { MAX_SOURCE_REFS } from '../chain/source-refs'
import type { BuildingScope } from '../rulesets/applicability'
import type { GraphEdition, KnowledgeGraph, ResolvedChain } from '../chain/graph'
import { nameOf, renderChainText, keyOfUse, roleSinceOf, type UseNotes } from '../chain/text'
import { PLATFORM_FRESHNESS_DAYS } from '../platform/freshness'
import type { ConnectingFactor, CoverageLevel, EditionRole, KnowledgeWorkKind } from '../wire/vocab'
import {
  GATE_STATES,
  MAX_CONTEXT_TEXT_CHARS,
  MAX_CONTEXT_USES,
  MAX_ISSUER_CHARS,
  type ContextUse,
  type Gate,
  type GateState,
  type KnowledgeContext,
  type Leaf,
  type ProcedureContext,
  type UseLabel,
  type UseRoute,
} from './wire'

export interface SiteLeaf {
  territoryId: string
  certainty: Leaf['certainty']
}

export interface ContextInputs {
  homeCountry: string | null
  entitled: ReadonlySet<string>
  sites: readonly SiteLeaf[]
  graph: KnowledgeGraph | null
  truncated: boolean
  date: string
  dateBasis?: ProcedureContext['referenceDates'][string]['basis']
  now: Date
  procedures: readonly ProcedureContext[]
  packSeqs: Readonly<Record<string, number>>
  building?: BuildingScope | null
}

const DAY_MS = 24 * 60 * 60 * 1000

export function countryOf(territoryId: string): string | null {
  return /^([A-Z]{2})(?:$|[-:])/.exec(territoryId)?.[1] ?? null
}

export function weakerGate(a: GateState, b: GateState): GateState {
  return GATE_STATES.indexOf(a) <= GATE_STATES.indexOf(b) ? a : b
}

export function coverageAt(
  graph: KnowledgeGraph,
  chain: readonly string[],
  country: string,
): { level: CoverageLevel | null; municipalLaw: boolean | null } {
  for (const id of chain) {
    if (countryOf(id) !== country) continue
    const territory = graph.territories.get(id)
    if (territory?.coverageLevel) return { level: territory.coverageLevel, municipalLaw: territory.municipalLaw ?? null }
  }
  return { level: null, municipalLaw: null }
}

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort()

function refusal(state: GateState, inputs: ContextInputs, leaves: Leaf[], retrieval: string[], reason: Gate['reason'] = null): KnowledgeContext {
  return {
    gate: { state, reason, leaves },
    packs: [],
    chains: {},
    date: inputs.date,
    procedures: [...inputs.procedures],
    uses: [],
    text: null,
    retrieval: { countries: retrieval },
  }
}

type Freshness = Pick<ContextUse, 'freshness' | 'lastCheckedAt'> & { stale: boolean; overdue: boolean }

export function freshnessOf(kind: KnowledgeWorkKind, edition: GraphEdition | undefined, now: Date): Freshness {
  if (!edition) return { freshness: 'current', lastCheckedAt: null, stale: false, overdue: false }
  const check = edition.lastCheck ?? null
  const lastCheckedAt = check ? check.checkedAt.slice(0, 10) : null
  if (check?.result === 'newer_known') return { freshness: 'newer_known', lastCheckedAt, stale: false, overdue: false }
  if (check?.result === 'withdrawn') return { freshness: 'superseded', lastCheckedAt, stale: false, overdue: false }
  const target = PLATFORM_FRESHNESS_DAYS[kind] * DAY_MS
  const age = check && check.result === 'current' ? now.getTime() - new Date(check.checkedAt).getTime() : Number.POSITIVE_INFINITY
  if (age < target) return { freshness: 'current', lastCheckedAt, stale: false, overdue: false }
  return { freshness: 'check_due', lastCheckedAt, stale: age >= 2 * target, overdue: true }
}

type ResolvedUse = ReturnType<typeof resolveChain>['uses'][number]

export function routeOf(graph: KnowledgeGraph, use: Pick<ResolvedUse, 'route'>): UseRoute | null {
  const last = use.route.at(-1)
  if (!last || last.via !== 'relation') return null
  const work = graph.works.get(last.workId)
  const edition = last.editionId ? graph.editions.get(last.editionId) : undefined
  return {
    workId: last.workId,
    designation: work?.designation ? nameOf(work.designation) : null,
    editionLabel: edition?.label ? nameOf(edition.label) : null,
    provision: last.provision ? nameOf(last.provision).slice(0, 300) : null,
  }
}

const siteOnly = (factors: readonly ConnectingFactor[]): boolean => factors.length === 1 && factors[0] === 'site'

function contextUse(
  graph: KnowledgeGraph,
  use: ReturnType<typeof resolveChain>['uses'][number],
  coverage: CoverageLevel,
  inputs: ContextInputs,
): ContextUse | null {
  const work = graph.works.get(use.workId)
  if (!work) return null
  const edition = use.editionId ? graph.editions.get(use.editionId) : undefined
  const connectsBy = [...(work.connectsBy ?? ['site'])]
  const labels: UseLabel[] = []
  let role: EditionRole = use.role
  let qualifier: ContextUse['qualifier'] = use.qualifier
  if (!siteOnly(connectsBy)) {
    role = 'information'
    qualifier = null
    labels.push('depends_on_connecting_factor')
  } else if (coverage === 'open') {
    if (role === 'binding' && qualifier === null) {
      qualifier = 'uncurated'
      labels.push('uncurated_source')
    } else if (role !== 'binding') {
      role = 'information'
    }
  }
  const fresh = freshnessOf(work.kind, edition, inputs.now)
  if (fresh.overdue) labels.push('check_overdue')
  if (fresh.stale) {
    labels.push('unchecked_since')
    if (role === 'binding' && qualifier === 'uncurated') {
      role = 'information'
      qualifier = null
    }
  }
  return {
    workId: use.workId,
    editionId: use.editionId,
    role,
    qualifier,
    via: use.route.at(-1)?.via ?? 'none',
    route: routeOf(graph, use),
    roleSince: role === 'binding' ? roleSinceOf(graph, use, edition) : null,
    date: inputs.date,
    freshness: fresh.freshness,
    lastCheckedAt: fresh.lastCheckedAt,
    connectsBy,
    labels,
    corpusFiles: [...(edition?.corpusFiles ?? [])],
    designation: work.designation ? nameOf(work.designation) : null,
    editionLabel: edition?.label ? nameOf(edition.label) : null,
    issuer: work.issuer ? nameOf(work.issuer).slice(0, MAX_ISSUER_CHARS) : null,
    sourceRefs: [...(work.sourceRefs ?? [])].slice(0, MAX_SOURCE_REFS),
    sourceUrl: edition?.sourceUrl ?? null,
    language: edition?.text?.language ?? null,
    textStatus: edition?.text?.status ?? null,
    applicability: use.applicability,
  }
}

function textOf(graph: KnowledgeGraph, resolved: ResolvedChain, uses: readonly ContextUse[], leafId: string, onFilingDay: boolean): string | null {
  const corrected = new Map(uses.map((use) => [keyOfUse(use), use]))
  const named = resolved.uses.flatMap((use) => {
    const context = corrected.get(keyOfUse(use))
    return context ? [{ ...use, role: context.role }] : []
  })
  const lawHere = named.some((use) => use.role === 'binding' && use.route.length === 1 && use.route[0]?.via === 'territory')
  if (!lawHere && resolved.undetermined.length === 0) return null
  const notes = new Map<string, UseNotes>([...corrected].map(([key, use]) => [key, use]))
  return capText(renderChainText(graph, { ...resolved, uses: named }, graph.territories.get(leafId)?.name ?? leafId, notes, onFilingDay))
}

export function capText(text: string): string {
  if (text.length <= MAX_CONTEXT_TEXT_CHARS) return text
  const note = '\n[The rest of the building law at this site is cut; ask about one instrument by name.]'
  const cut = text.slice(0, MAX_CONTEXT_TEXT_CHARS - note.length)
  return `${cut.slice(0, Math.max(cut.lastIndexOf('\n'), 0))}${note}`
}

function retrievalOf(graph: KnowledgeGraph, chain: readonly string[], country: string): string[] {
  const unions = chain.filter((id) => /^[A-Z]{2}$/.test(id) && id !== country && graph.territories.get(id)?.kind === 'union')
  return sorted([country, ...unions])
}

export function resolveKnowledgeContext(inputs: ContextInputs): KnowledgeContext {
  if (!inputs.homeCountry) return refusal('organization_unplaced', inputs, [], [])
  const first = inputs.sites[0]
  if (!first) return refusal('site_unknown', inputs, [], sorted(inputs.entitled), 'no_site')
  const country = countryOf(first.territoryId)
  if (!country) return refusal('site_unknown', inputs, [], sorted(inputs.entitled), 'no_territory')
  const leaf: Leaf = { territoryId: first.territoryId, country, certainty: first.certainty, entitled: inputs.entitled.has(country), coverage: null, municipalLaw: null }
  if (!leaf.entitled) return refusal('not_entitled', inputs, [leaf], [])
  const graph = inputs.graph
  if (!graph || inputs.truncated) return refusal('knowledge_unavailable', inputs, [leaf], [])

  const chain = chainAt(first.territoryId, inputs.date, graph)
  const held = coverageAt(graph, chain, country)
  leaf.coverage = held.level
  leaf.municipalLaw = held.municipalLaw
  const coverage = leaf.coverage ?? 'none'
  const retrieval = retrievalOf(graph, chain, country)
  const base: KnowledgeContext = {
    gate: { state: coverage, reason: null, leaves: [leaf] },
    packs: retrieval.map((packId) => ({ packId, seq: inputs.packSeqs[packId] ?? 0 })),
    chains: { [first.territoryId]: chain.slice(0, 16) },
    date: inputs.date,
    procedures: [...inputs.procedures],
    uses: [],
    text: null,
    retrieval: { countries: retrieval },
  }
  if (coverage === 'none') return base
  const resolved = resolveChain(graph, first.territoryId, inputs.date, inputs.building ?? null)
  const uses = resolved.uses.map((use) => contextUse(graph, use, coverage, inputs)).filter((use): use is ContextUse => use !== null)
  const carried = [...uses].sort((a, b) => roleRank(a.role) - roleRank(b.role))
  return {
    ...base,
    uses: carried.slice(0, MAX_CONTEXT_USES),
    undetermined: resolved.undetermined.slice(0, MAX_CONTEXT_USES).map(({ workId, reason }) => ({ workId, reason })),
    text: textOf(graph, resolved, uses, first.territoryId, inputs.dateBasis === 'filed_on'),
  }
}
