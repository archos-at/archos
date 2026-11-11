/**
 * The knowledge context of a turn from what the BFF read (design §5.5 steps
 * 1 to 6, §4.6, ADR-0173). Pure: `./load.ts` reads the inputs, a spec writes
 * them by hand ("paper" fixtures, `evals/base-knowledge/edge_cases.yaml`).
 *
 * The gate fails closed at every step: no home country, no site, a country not
 * entitled, records that could not be read or hit their bound, a node with no
 * coverage record. Only a gate of `open` or better carries uses, and at `open`
 * a binding role is `uncurated` and every other role is information. Freshness
 * degrades the label: past its kind's target an edition is `check_overdue`,
 * past twice the target (or never checked) `unchecked_since`, and an uncurated
 * binding edition becomes information. A work that attaches to the office's
 * seat or the client, not the site, is information (E40). Nothing here depends
 * on a country: adding one adds records.
 */

import { chainAt, resolveChain } from '../chain/resolve'
import type { BuildingScope } from '../rulesets/applicability'
import type { GraphEdition, KnowledgeGraph, ResolvedChain } from '../chain/graph'
import { nameOf, renderChainText, keyOfUse, type UseNotes } from '../chain/text'
import { PLATFORM_FRESHNESS_DAYS } from '../platform/freshness'
import type { ConnectingFactor, CoverageLevel, EditionRole, KnowledgeWorkKind } from '../wire/vocab'
import {
  GATE_STATES,
  MAX_CONTEXT_TEXT_CHARS,
  MAX_CONTEXT_USES,
  type ContextUse,
  type Gate,
  type GateState,
  type KnowledgeContext,
  type Leaf,
  type ProcedureContext,
  type UseLabel,
} from './wire'

export interface SiteLeaf {
  territoryId: string
  certainty: Leaf['certainty']
}

export interface ContextInputs {
  /** The office's home country; null when the office was never placed. */
  homeCountry: string | null
  /** Every country the office is entitled to, its home included. */
  entitled: ReadonlySet<string>
  /** The site's leaves; empty when the project states none or there is no project. */
  sites: readonly SiteLeaf[]
  /** The graph read for the first leaf; null when it could not be read. */
  graph: KnowledgeGraph | null
  /** The graph hit its bound: what was left out reads as nothing, so the turn uses none of it. */
  truncated: boolean
  /** The day in the office's zone the turn resolves at. */
  date: string
  now: Date
  procedures: readonly ProcedureContext[]
  /** The newest stable release sequence per pack. */
  packSeqs: Readonly<Record<string, number>>
  /** The project's buildings, read by each edition's scope (ADR-0178); null or absent narrows nothing. */
  building?: BuildingScope | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The country a territory id names: `AT` of `AT-6` and of `AT:gkz:60101`. */
export function countryOf(territoryId: string): string | null {
  return /^([A-Z]{2})(?:$|[-:])/.exec(territoryId)?.[1] ?? null
}

/** The weaker of two gate states: the order of `GATE_STATES`. */
export function weakerGate(a: GateState, b: GateState): GateState {
  return GATE_STATES.indexOf(a) <= GATE_STATES.indexOf(b) ? a : b
}

/**
 * The coverage that holds at a leaf: the nearest node of its own country on
 * the chain that states one. A union (`EU`) never lends its coverage to a
 * member. Null when none states one.
 */
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

/** How current an edition is by the platform's newest check of it; law read live is current by definition. */
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

const siteOnly = (factors: readonly ConnectingFactor[]): boolean => factors.length === 1 && factors[0] === 'site'

/** One resolved use, with the coverage qualifier, the freshness degradation and the connecting factor applied. */
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
    // HOAI, VgV: the site's chain alone never makes it bind (E40).
    role = 'information'
    qualifier = null
    labels.push('depends_on_connecting_factor')
  } else if (coverage === 'open') {
    // Nobody curated this node: law is binding only as uncurated, everything else is information (design §4.6).
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
    // Past twice its target an uncurated binding edition no longer binds (E28).
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
    date: inputs.date,
    freshness: fresh.freshness,
    lastCheckedAt: fresh.lastCheckedAt,
    connectsBy,
    labels,
    corpusFiles: [...(edition?.corpusFiles ?? [])],
    designation: work.designation ? nameOf(work.designation) : null,
    editionLabel: edition?.label ? nameOf(edition.label) : null,
    sourceRefs: [...(work.sourceRefs ?? [])].slice(0, 8),
    sourceUrl: edition?.sourceUrl ?? null,
    applicability: use.applicability,
  }
}

/**
 * The chain text of a resolution in the roles the context gives each use: the
 * open-coverage, freshness and connecting-factor corrections reach the words
 * the agent reads, so the block and the uses never disagree. Null where no
 * law binds in its own territory by the records: there is no chain to read.
 */
function textOf(graph: KnowledgeGraph, resolved: ResolvedChain, uses: readonly ContextUse[], leafId: string): string | null {
  const corrected = new Map(uses.map((use) => [keyOfUse(use), use]))
  const named = resolved.uses.flatMap((use) => {
    const context = corrected.get(keyOfUse(use))
    return context ? [{ ...use, role: context.role }] : []
  })
  const lawHere = named.some((use) => use.role === 'binding' && use.route.length === 1 && use.route[0]?.via === 'territory')
  // A law whose edition is undetermined still reaches the turn: its "Not determined here" line says so, never silence.
  if (!lawHere && resolved.undetermined.length === 0) return null
  const notes = new Map<string, UseNotes>([...corrected].map(([key, use]) => [key, use]))
  return capText(renderChainText(graph, { ...resolved, uses: named }, graph.territories.get(leafId)?.name ?? leafId, notes))
}

/** The text within the wire's bound (`MAX_CONTEXT_TEXT_CHARS`): cut at a line, with a note saying so. */
export function capText(text: string): string {
  if (text.length <= MAX_CONTEXT_TEXT_CHARS) return text
  const note = '\n[The rest of the building law at this site is cut; ask about one instrument by name.]'
  const cut = text.slice(0, MAX_CONTEXT_TEXT_CHARS - note.length)
  return `${cut.slice(0, Math.max(cut.lastIndexOf('\n'), 0))}${note}`
}

/** The countries a site's chain reads from the shared corpus: its own, and a union the graph let it read. */
function retrievalOf(graph: KnowledgeGraph, chain: readonly string[], country: string): string[] {
  const unions = chain.filter((id) => /^[A-Z]{2}$/.test(id) && id !== country && graph.territories.get(id)?.kind === 'union')
  return sorted([country, ...unions])
}

/** The knowledge context of a turn. */
export function resolveKnowledgeContext(inputs: ContextInputs): KnowledgeContext {
  if (!inputs.homeCountry) return refusal('organization_unplaced', inputs, [], [])
  const first = inputs.sites[0]
  // No site: the turn may read what the office is entitled to, and the answer asks for the place (E04).
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
  // `none` holds territories only: "Für <Land> sind keine Grundlagen hinterlegt".
  if (coverage === 'none') return base
  const resolved = resolveChain(graph, first.territoryId, inputs.date, inputs.building ?? null)
  if (resolved.truncated) return refusal('knowledge_unavailable', inputs, [leaf], [])
  const uses = resolved.uses
    .map((use) => contextUse(graph, use, coverage, inputs))
    .filter((use): use is ContextUse => use !== null)
    .slice(0, MAX_CONTEXT_USES)
  return {
    ...base,
    uses,
    undetermined: resolved.undetermined.slice(0, MAX_CONTEXT_USES).map(({ workId, reason }) => ({ workId, reason })),
    text: textOf(graph, resolved, uses, first.territoryId),
  }
}
