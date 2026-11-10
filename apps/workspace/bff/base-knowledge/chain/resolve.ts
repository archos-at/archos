/**
 * Which edition of which instrument binds a site on a date, and why (ADR-0168,
 * design §3.5 and §5.5 steps 1, 3 and 6). Pure: the graph in, the uses out.
 *
 * - **The chain** is the site's leaf and every territory it lies in at the
 *   date: undated parents, dated parents in force (`AT` in `EU` from
 *   1995-01-01, `GB` in it until 2020-12-31), and an ISO 3166-2 code's country.
 * - **Law binds** in its territory while in force: a statute or ordinance
 *   whose territory is on the chain, in the edition in force at the date (or
 *   live at its source when the platform holds no edition), unless a
 *   `supersedes` in force says it no longer applies.
 * - **Everything else binds only through a route**: a `makes_binding` from a
 *   binding instrument, in force at the date, to an edition (declared, static)
 *   or to a work (dynamic: its edition in force at the date). Routes are
 *   followed to depth eight, each instrument once; the target may sit in any
 *   pack of the graph (design §3.5, "resolution across packs"). A directive,
 *   a commentary and an authority directive never bind, whatever points at them.
 * - **`deviates_from`** from a binding instrument displaces the target's
 *   clauses here, for every owner's copy alike.
 * - **Without a route**, a norm's newest edition guides and its older ones are
 *   information; a commentary interprets; an authority directive is the
 *   practice of its addressees, where they decide; an EU directive, an
 *   unreached administrative regulation or agreement is information.
 * - **Precedence** (design §5.5): one graph for both owners. A route through
 *   an office's relation reads `office_maintained`; a platform relation of the
 *   same type on the same target and anchors displaces the office's.
 *
 * Which edition of a work is in force is `time/editions.ts`'s one rule, read
 * through `editionFor`. Unknown fails closed: an edition a relation names that
 * is not in the graph, or a law whose editions are all out of force at the
 * date, yields no use; a law whose edition at the date is unknown yields none
 * either and is listed as `undetermined`.
 */

import type { DatedEdition } from '../wire/time'
import type { EditionRole, KnowledgeWorkKind } from '../wire/vocab'
import { editionInForce, newestInForce, type EditionOnDay } from '../time/editions'
import type {
  Displacement,
  EditionUse,
  GraphEdition,
  GraphRelation,
  GraphWork,
  KnowledgeGraph,
  ResolvedChain,
  RouteStep,
  UndeterminedLaw,
} from './graph'

/** How deep a route is followed (design §3.6). */
export const MAX_ROUTE_DEPTH = 8

/** Most uses one resolution returns (design §5.5, `works ≤ 40`). */
export const MAX_USES = 40

const LAW_KINDS: ReadonlySet<KnowledgeWorkKind> = new Set(['statute', 'ordinance'])

/** What a `makes_binding` can make binding. A directive, a commentary and an authority directive never bind a project. */
const BINDABLE_KINDS: ReadonlySet<KnowledgeWorkKind> = new Set([
  'statute',
  'ordinance',
  'administrative_regulation',
  'intergovernmental_agreement',
  'model_code',
  'technical_standard',
  'guideline',
])

/** Norms whose newest unrouted edition guides. */
const NORM_KINDS: ReadonlySet<KnowledgeWorkKind> = new Set(['model_code', 'technical_standard', 'guideline'])

/** Kinds that are information when nothing reaches them. */
const INFORMATION_KINDS: ReadonlySet<KnowledgeWorkKind> = new Set(['directive', 'administrative_regulation', 'intergovernmental_agreement'])

const ROLE_ORDER: readonly EditionRole[] = ['binding', 'authority_practice', 'guidance', 'interpretation', 'information']

/** Half-open: from inclusive, to exclusive; a missing end is open. */
export function inInterval(date: string, from: string | null | undefined, to: string | null | undefined): boolean {
  return (!from || from <= date) && (!to || date < to)
}

/** The site's leaf, then every territory it lies in at `date`. */
export function chainAt(leafId: string, date: string, graph: KnowledgeGraph): string[] {
  const chain: string[] = []
  const queue = [leafId]
  while (queue.length > 0 && chain.length < 32) {
    const next = queue.shift() as string
    if (chain.includes(next)) continue
    chain.push(next)
    const territory = graph.territories.get(next)
    if (territory) {
      queue.push(...territory.parentIds)
      queue.push(...territory.datedParents.filter((parent) => inInterval(date, parent.validFrom, parent.validTo)).map((parent) => parent.id))
    }
    // An ISO 3166-2 subdivision lies in its country whether or not its record says so.
    const iso = /^([A-Z]{2})-/.exec(next)
    if (iso) queue.push(iso[1])
  }
  return chain
}

const editionDate = (edition: GraphEdition): string => edition.inForceFrom ?? edition.issuedOn ?? ''

function editionsOf(graph: KnowledgeGraph, workId: string): GraphEdition[] {
  return [...graph.editions.values()].filter((edition) => edition.workId === workId)
}

/**
 * Which edition of a work applies: the resolver asks it for every law on the
 * chain and every work a route names. The default is the edition in force at
 * the resolution's date; a caller that knows a reference date per procedure
 * and work (design §3.6, `time/as-of.ts`) passes its own.
 */
export type EditionFor = (workId: string) => EditionOnDay

/**
 * A graph edition as the in-force rules read it. A platform law edition is in
 * force from its in-force date only (ADR-0171). An office's own law edition
 * is entered with its issue date alone (`store/repository.ts`), so it counts
 * from its issue, as do a norm, a guideline and a commentary, which have no
 * in-force date of their own.
 */
function datedEdition(edition: GraphEdition, work: GraphWork | undefined): DatedEdition {
  const countsFromIssue = !work || !LAW_KINDS.has(work.kind) || edition.owner === 'office'
  return {
    id: edition.id,
    label: edition.label,
    inForceFrom: edition.inForceFrom ?? (countsFromIssue ? edition.issuedOn : null),
    inForceTo: edition.inForceTo,
    transition: null,
  }
}

/**
 * The edition of each work at `date` (`time/editions.ts`): law by the one
 * in-force rule, where an undated edition beside dated ones is left out rather
 * than undetermining the work; every other kind by its newest edition not
 * withdrawn, since a new Ausgabe replaces the old one without an end date.
 */
export function editionsInForceAt(graph: KnowledgeGraph, date: string): EditionFor {
  return (workId) => {
    const work = graph.works.get(workId)
    const editions = editionsOf(graph, workId).map((edition) => datedEdition(edition, work))
    if (work && !LAW_KINDS.has(work.kind)) return newestInForce(editions, date)
    const dated = editions.filter((edition) => edition.inForceFrom !== null)
    return editionInForce(dated.length > 0 ? dated : editions, date, work?.historyAvailableFrom ?? null)
  }
}

/** The graph edition an answer names, or null when it names none. */
function determined(graph: KnowledgeGraph, found: EditionOnDay): GraphEdition | null {
  return found.status === 'determined' ? (graph.editions.get(found.edition.id) ?? null) : null
}

/** The newest edition at `date` that has not ended, by `time/editions.ts`; one that starts later, ended, or has no date does not count. */
function newestEdition(editions: readonly GraphEdition[], date: string): GraphEdition | null {
  const dated = editions.map((edition) => ({ ...datedEdition(edition, undefined), inForceFrom: editionDate(edition) || null }))
  const found = newestInForce(dated, date)
  return found.status === 'determined' ? (editions.find((edition) => edition.id === found.edition.id) ?? null) : null
}

const anchorsKey = (relation: GraphRelation) =>
  relation.anchors.map((anchor) => `${anchor.from ?? ''}>${anchor.to ?? ''}`).sort().join(',')

/** The work a relation end names: itself, or an edition's work. */
function endWork(graph: KnowledgeGraph, id: string, type: 'work' | 'edition'): string | null {
  return type === 'work' ? (graph.works.has(id) ? id : null) : (graph.editions.get(id)?.workId ?? null)
}

/** What makes two relations the same claim: type, from-instrument, the exact target and its anchors. */
const claimKey = (relation: GraphRelation) =>
  `${relation.relationType}|${relation.fromId}|${relation.toId}|${anchorsKey(relation)}`

/**
 * Relations in force at `date`, an office's left out where a platform relation
 * makes the same claim (design §5.5). Only the same claim: a platform route
 * from another Land, or to another edition, leaves the office's route alone.
 */
export function effectiveRelations(graph: KnowledgeGraph, date: string): GraphRelation[] {
  const inForce = graph.relations.filter((relation) => inInterval(date, relation.validFrom, relation.validTo))
  const platformClaims = new Set(inForce.filter((relation) => relation.owner === 'platform').map(claimKey))
  return inForce.filter((relation) => relation.owner === 'platform' || !platformClaims.has(claimKey(relation)))
}

interface Binding {
  workId: string
  editionId: string | null
  route: RouteStep[]
}

/** The edition a relation's target names: the edition itself, or the edition of the work that applies. */
function targetEdition(graph: KnowledgeGraph, relation: GraphRelation, editionFor: EditionFor): GraphEdition | null {
  if (relation.toType === 'edition') return graph.editions.get(relation.toId) ?? null
  return determined(graph, editionFor(relation.toId))
}

function supersededWorks(graph: KnowledgeGraph, relations: readonly GraphRelation[]): Set<string> {
  return new Set(
    relations
      .filter((relation) => relation.relationType === 'supersedes')
      .map((relation) => endWork(graph, relation.toId, relation.toType))
      .filter((id): id is string => id !== null),
  )
}

/**
 * Law in force on the chain: the routes' starting points. No edition held: it
 * is live at its source. Editions held and none in force: it does not apply
 * then. Editions held and the one in force unknown: it is undetermined, said
 * so, and binds nothing rather than a guessed edition.
 */
function lawSeeds(
  graph: KnowledgeGraph,
  chain: readonly string[],
  superseded: ReadonlySet<string>,
  editionFor: EditionFor,
): { seeds: Binding[]; undetermined: UndeterminedLaw[] } {
  const seeds: Binding[] = []
  const undetermined: UndeterminedLaw[] = []
  for (const work of graph.works.values()) {
    if (!LAW_KINDS.has(work.kind) || superseded.has(work.id)) continue
    if (!work.territoryIds.some((id) => chain.includes(id))) continue
    const route: RouteStep[] = [{ via: 'territory', workId: work.id, owner: work.owner }]
    if (editionsOf(graph, work.id).length === 0) {
      seeds.push({ workId: work.id, editionId: null, route })
      continue
    }
    const found = editionFor(work.id)
    if (found.status === 'determined') seeds.push({ workId: work.id, editionId: found.edition.id, route })
    else if (found.reason !== 'no_edition_in_force') undetermined.push({ workId: work.id, reason: found.reason })
  }
  return { seeds, undetermined }
}

const bindingKey = (workId: string, editionId: string | null) => `${workId}|${editionId ?? ''}`

/** Every binding instrument: law on the chain, then what its routes reach, breadth first. */
function followRoutes(graph: KnowledgeGraph, seeds: readonly Binding[], relations: readonly GraphRelation[], editionFor: EditionFor): Binding[] {
  const found = new Map<string, Binding>(seeds.map((seed) => [bindingKey(seed.workId, seed.editionId), seed]))
  let frontier = [...seeds]
  for (let depth = 0; depth < MAX_ROUTE_DEPTH && frontier.length > 0; depth++) {
    const next: Binding[] = []
    for (const from of frontier) {
      for (const relation of relations) {
        if (relation.relationType !== 'makes_binding') continue
        if (relation.fromId !== from.workId && relation.fromId !== from.editionId) continue
        const edition = targetEdition(graph, relation, editionFor)
        const work = edition ? graph.works.get(edition.workId) : undefined
        if (!edition || !work || !BINDABLE_KINDS.has(work.kind)) continue
        const key = bindingKey(work.id, edition.id)
        if (found.has(key)) continue
        const step: RouteStep = {
          via: 'relation',
          workId: from.workId,
          relationId: relation.id,
          provision: relation.provision,
          mode: relation.mode,
          owner: relation.owner,
        }
        const binding = { workId: work.id, editionId: edition.id, route: [...from.route, step] }
        found.set(key, binding)
        next.push(binding)
      }
    }
    frontier = next
  }
  return [...found.values()]
}

/** The clauses binding instruments displace, by target work. */
function displacements(graph: KnowledgeGraph, bindings: readonly Binding[], relations: readonly GraphRelation[]): Map<string, Displacement[]> {
  const binding = new Set(bindings.flatMap((entry) => [entry.workId, entry.editionId ?? '']))
  const byTarget = new Map<string, Displacement[]>()
  for (const relation of relations) {
    if (relation.relationType !== 'deviates_from' || !binding.has(relation.fromId)) continue
    const fromWork = endWork(graph, relation.fromId, relation.fromType)
    if (!fromWork) continue
    // Keyed by what the relation names: an edition's id, or a work's for every edition of it.
    const key = relation.toId
    const list = byTarget.get(key) ?? []
    for (const anchor of relation.anchors) {
      list.push({ anchor: anchor.to ?? null, replacedBy: anchor.from ?? null, byWorkId: fromWork, provision: relation.provision })
    }
    byTarget.set(key, list)
  }
  return byTarget
}

const qualifierOf = (route: readonly RouteStep[]): EditionUse['qualifier'] =>
  route.some((step) => step.owner === 'office') ? 'office_maintained' : null

function editionUse(
  workId: string,
  editionId: string | null,
  role: EditionRole,
  route: readonly RouteStep[],
  displaced: readonly Displacement[] = [],
  relatedEditionId: string | null = null,
): EditionUse {
  return { workId, editionId, role, qualifier: qualifierOf(route), route, displaced, relatedEditionId }
}

/** Whether a work that nothing makes binding concerns this site. */
function inScope(work: GraphWork, chain: readonly string[], interpretsInScope: boolean): boolean {
  if (work.kind === 'authority_directive' && work.addresseeTerritoryIds.length > 0) {
    return work.addresseeTerritoryIds.some((id) => chain.includes(id))
  }
  return work.territoryIds.some((id) => chain.includes(id)) || interpretsInScope
}

/**
 * What a commentary interprets, by the `interprets` relations in force from it
 * or its editions: the works, and the edition the first one names or holds in force.
 */
function interpreted(
  graph: KnowledgeGraph,
  work: GraphWork,
  relations: readonly GraphRelation[],
  editionFor: EditionFor,
): { works: GraphWork[]; editionId: string | null } {
  const own = new Set([work.id, ...editionsOf(graph, work.id).map((edition) => edition.id)])
  const found = relations.filter((candidate) => candidate.relationType === 'interprets' && own.has(candidate.fromId))
  const works = found
    .map((relation) => endWork(graph, relation.toId, relation.toType))
    .flatMap((id) => (id && graph.works.get(id) ? [graph.works.get(id) as GraphWork] : []))
  return { works, editionId: found[0] ? (targetEdition(graph, found[0], editionFor)?.id ?? null) : null }
}

/** The uses of a work no route reaches, or of its editions no route reaches. */
function unroutedUses(
  graph: KnowledgeGraph,
  work: GraphWork,
  context: {
    chain: readonly string[]
    date: string
    editionFor: EditionFor
    relations: readonly GraphRelation[]
    boundEditions: readonly string[]
    boundWorks: readonly string[]
  },
): EditionUse[] {
  const editions = editionsOf(graph, work.id)
  const bound = editions.filter((edition) => context.boundEditions.includes(edition.id))
  const rest = editions.filter((edition) => !context.boundEditions.includes(edition.id))
  if (work.kind === 'commentary') {
    const target = interpreted(graph, work, context.relations, context.editionFor)
    const interpretsHere = target.works.some(
      (interpretedWork) => inScope(interpretedWork, context.chain, false) || context.boundWorks.includes(interpretedWork.id),
    )
    if (!inScope(work, context.chain, interpretsHere)) return []
    const newest = newestEdition(editions, context.date)
    return newest ? [editionUse(work.id, newest.id, 'interpretation', [], [], target.editionId)] : []
  }
  if (bound.length === 0 && !inScope(work, context.chain, false)) return []
  if (work.kind === 'authority_directive') {
    const newest = newestEdition(editions, context.date)
    return newest ? [editionUse(work.id, newest.id, 'authority_practice', [])] : []
  }
  if (NORM_KINDS.has(work.kind)) {
    const newest = newestEdition(rest, context.date)
    const bindingEdition = bound[0]?.id ?? null
    // The newest edition guides only when it is newer than what binds; anything older is information.
    const guides = newest && (!bound[0] || editionDate(newest) > editionDate(bound[0])) ? newest : null
    return rest.map((edition) =>
      editionUse(work.id, edition.id, edition.id === guides?.id ? 'guidance' : 'information', [], [], bindingEdition),
    )
  }
  if (INFORMATION_KINDS.has(work.kind) && bound.length === 0) {
    const newest = newestEdition(editions, context.date)
    return newest ? [editionUse(work.id, newest.id, 'information', [])] : []
  }
  return []
}

const roleRank = (role: EditionRole) => ROLE_ORDER.indexOf(role)

/**
 * Resolve a site on a date: the chain, and what each edition is to it.
 * `editionFor` says which edition of a work applies; by default the one in
 * force at `date`, and a reference date per procedure and work plugs in here.
 */
export function resolveChain(
  graph: KnowledgeGraph,
  leafId: string,
  date: string,
  editionFor: EditionFor = editionsInForceAt(graph, date),
): ResolvedChain {
  const chain = chainAt(leafId, date, graph)
  const relations = effectiveRelations(graph, date)
  const superseded = supersededWorks(graph, relations)
  const { seeds, undetermined } = lawSeeds(graph, chain, superseded, editionFor)
  const bindings = followRoutes(graph, seeds, relations, editionFor)
  const displaced = displacements(graph, bindings, relations)
  const uses: EditionUse[] = bindings.map((binding) =>
    editionUse(binding.workId, binding.editionId, 'binding', binding.route, [
      ...(displaced.get(binding.workId) ?? []),
      ...(binding.editionId ? (displaced.get(binding.editionId) ?? []) : []),
    ]),
  )
  const boundEditions = bindings.flatMap((binding) => (binding.editionId ? [binding.editionId] : []))
  const boundWorks = new Set(bindings.map((binding) => binding.workId))
  for (const work of graph.works.values()) {
    if (LAW_KINDS.has(work.kind) && boundWorks.has(work.id)) continue
    uses.push(...unroutedUses(graph, work, { chain, date, editionFor, relations, boundEditions, boundWorks: [...boundWorks] }))
  }
  const titles = new Map([...graph.works.values()].map((work) => [work.id, work.title]))
  uses.sort(
    (a, b) =>
      roleRank(a.role) - roleRank(b.role) ||
      a.route.length - b.route.length ||
      (titles.get(a.workId) ?? '').localeCompare(titles.get(b.workId) ?? '', 'de') ||
      (a.editionId ?? '').localeCompare(b.editionId ?? ''),
  )
  return { date, chain, uses: uses.slice(0, MAX_USES), truncated: uses.length > MAX_USES, undetermined }
}
