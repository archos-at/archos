import { applicabilityOf, type BuildingScope } from '../rulesets/applicability'
import type { DatedEdition } from '../wire/time'
import type { EditionRole, KnowledgeWorkKind } from '../wire/vocab'
import { editionInForce, newestInForce, type EditionOnDay } from '../time/editions'
import { chainAt as walkChain, inInterval } from './territory-chain'
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


export const MAX_ROUTE_DEPTH = 8

const LAW_KINDS: ReadonlySet<KnowledgeWorkKind> = new Set(['statute', 'ordinance'])

const BINDABLE_KINDS: ReadonlySet<KnowledgeWorkKind> = new Set([
  'statute',
  'ordinance',
  'administrative_regulation',
  'intergovernmental_agreement',
  'model_code',
  'technical_standard',
  'guideline',
])

const NORM_KINDS: ReadonlySet<KnowledgeWorkKind> = new Set(['model_code', 'technical_standard', 'guideline'])

const INFORMATION_KINDS: ReadonlySet<KnowledgeWorkKind> = new Set(['directive', 'administrative_regulation', 'intergovernmental_agreement'])

const ROLE_ORDER: readonly EditionRole[] = ['binding', 'authority_practice', 'guidance', 'interpretation', 'information']

export function chainAt(leafId: string, date: string, graph: KnowledgeGraph): string[] {
  return walkChain(leafId, date, (id) => graph.territories.get(id)?.parents)
}

const editionDate = (edition: GraphEdition): string => edition.inForceFrom ?? edition.issuedOn ?? ''

const editionsByWork = new WeakMap<KnowledgeGraph, Map<string, GraphEdition[]>>()

function editionsOf(graph: KnowledgeGraph, workId: string): readonly GraphEdition[] {
  let index = editionsByWork.get(graph)
  if (!index) {
    index = Map.groupBy(graph.editions.values(), (edition) => edition.workId)
    editionsByWork.set(graph, index)
  }
  return index.get(workId) ?? []
}

export type EditionFor = (workId: string) => EditionOnDay

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

export function editionsInForceAt(graph: KnowledgeGraph, date: string): EditionFor {
  return (workId) => {
    const work = graph.works.get(workId)
    const editions = editionsOf(graph, workId).map((edition) => datedEdition(edition, work))
    if (work && !LAW_KINDS.has(work.kind)) return newestInForce(editions, date)
    const dated = editions.filter((edition) => edition.inForceFrom !== null)
    return editionInForce(dated.length > 0 ? dated : editions, date, work?.historyAvailableFrom ?? null)
  }
}

function determined(graph: KnowledgeGraph, found: EditionOnDay): GraphEdition | null {
  return found.status === 'determined' ? (graph.editions.get(found.edition.id) ?? null) : null
}

function newestEdition(editions: readonly GraphEdition[], date: string): GraphEdition | null {
  const dated = editions.map((edition) => ({ ...datedEdition(edition, undefined), inForceFrom: editionDate(edition) || null }))
  const found = newestInForce(dated, date)
  return found.status === 'determined' ? (editions.find((edition) => edition.id === found.edition.id) ?? null) : null
}

const anchorsKey = (relation: GraphRelation) =>
  relation.anchors.map((anchor) => `${anchor.from ?? ''}>${anchor.to ?? ''}`).sort().join(',')

function endWork(graph: KnowledgeGraph, id: string, type: 'work' | 'edition'): string | null {
  return type === 'work' ? (graph.works.has(id) ? id : null) : (graph.editions.get(id)?.workId ?? null)
}

const claimKey = (relation: GraphRelation) =>
  `${relation.relationType}|${relation.fromId}|${relation.toId}|${anchorsKey(relation)}`

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

function followRoutes(graph: KnowledgeGraph, seeds: readonly Binding[], relations: readonly GraphRelation[], editionFor: EditionFor): Binding[] {
  const found = new Map<string, Binding>(seeds.map((seed) => [bindingKey(seed.workId, seed.editionId), seed]))
  const routes = relations.filter((relation) => relation.relationType === 'makes_binding')
  const byFrom = Map.groupBy(routes, (relation) => relation.fromId)
  const position = new Map(routes.map((relation, index) => [relation, index]))
  let frontier = [...seeds]
  for (let depth = 0; depth < MAX_ROUTE_DEPTH && frontier.length > 0; depth++) {
    const next: Binding[] = []
    for (const from of frontier) {
      const outgoing = [...(byFrom.get(from.workId) ?? []), ...(from.editionId ? (byFrom.get(from.editionId) ?? []) : [])]
      for (const relation of outgoing.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0))) {
        const edition = targetEdition(graph, relation, editionFor)
        const work = edition ? graph.works.get(edition.workId) : undefined
        if (!edition || !work || !BINDABLE_KINDS.has(work.kind)) continue
        const key = bindingKey(work.id, edition.id)
        if (found.has(key)) continue
        const step: RouteStep = {
          via: 'relation',
          workId: from.workId,
          editionId: from.editionId,
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

function displacements(graph: KnowledgeGraph, bindings: readonly Binding[], relations: readonly GraphRelation[]): Map<string, Displacement[]> {
  const binding = new Set(bindings.flatMap((entry) => [entry.workId, entry.editionId ?? '']))
  const byTarget = new Map<string, Displacement[]>()
  for (const relation of relations) {
    if (relation.relationType !== 'deviates_from' || !binding.has(relation.fromId)) continue
    const fromWork = endWork(graph, relation.fromId, relation.fromType)
    if (!fromWork) continue
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
  return { workId, editionId, role, qualifier: qualifierOf(route), route, displaced, relatedEditionId, applicability: null }
}

function inScope(work: GraphWork, chain: readonly string[], interpretsInScope: boolean): boolean {
  if (work.kind === 'authority_directive' && work.addresseeTerritoryIds.length > 0) {
    return work.addresseeTerritoryIds.some((id) => chain.includes(id))
  }
  return work.territoryIds.some((id) => chain.includes(id)) || interpretsInScope
}

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

export const roleRank = (role: EditionRole) => ROLE_ORDER.indexOf(role)

function narrowed(graph: KnowledgeGraph, uses: readonly EditionUse[], scope: BuildingScope): EditionUse[] {
  return uses.flatMap((use) => {
    const table = use.editionId ? graph.editions.get(use.editionId)?.appliesWhen : null
    if (!table) return [use]
    const applicability = applicabilityOf(table, scope)
    return applicability.verdict === 'not_applicable' ? [] : [{ ...use, applicability }]
  })
}

export function resolveChain(
  graph: KnowledgeGraph,
  leafId: string,
  date: string,
  building: BuildingScope | null = null,
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
  const named = building ? narrowed(graph, uses, building) : uses
  named.sort(
    (a, b) =>
      roleRank(a.role) - roleRank(b.role) ||
      a.route.length - b.route.length ||
      (titles.get(a.workId) ?? '').localeCompare(titles.get(b.workId) ?? '', 'de') ||
      (a.editionId ?? '').localeCompare(b.editionId ?? ''),
  )
  return { date, chain, uses: named, undetermined }
}
