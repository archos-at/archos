/**
 * A country's law as a person reads it (docs/design/international/country-onboarding-ux.md):
 * the territory tree, and for each region the acts that make guideline
 * editions binding there, grouped into adoption statements. A statement is
 * one act adopting editions on one day; Austria's 135 bindings are 17 of them.
 *
 * Pure, and computed from the records of a change request as the review reads
 * them (`RevisionView`), so the map is a view of what the door already serves
 * (`platform-knowledge-change-request-get`) and needs no route of its own.
 * Nothing here names a country: rows come from the territory records,
 * columns from the works the relations bind.
 */

import type { CaptureView, RevisionView } from './wire'

export type ReviewState = 'accepted' | 'rejected' | 'open'

/** Where a statement's citations point: a host the region's own law is read at, another page, or nothing. */
export type SourceKind = 'primary' | 'secondary' | 'none'

export interface LawMapTerritory {
  id: string
  name: string
  kind: string
  parentId: string | null
  children: string[]
}

export interface LawMapEdition {
  id: string
  workId: string
  label: string
  issuedOn: string | null
}

/** A column: a work some relation makes binding (a guideline series, a standard). */
export interface LawMapTopic {
  workId: string
  designation: string
  title: string
}

/** A work that applies in a region by itself (its building act), read where it is published. */
export interface LawMapStatute {
  workId: string
  territoryId: string
  title: string
  designation: string
  url: string | null
  review: ReviewState
}

export interface LawMapCell {
  relationId: string
  editionId: string
  topicWorkId: string
  validFrom: string | null
  validTo: string | null
}

export interface LawMapDeviation {
  relationId: string
  editionId: string
  provision: string | null
  anchors: string[]
}

export interface LawMapSource {
  url: string
  quote: string | null
  note: string | null
}

/** One act adopting editions in one region from one day: the unit a person checks. */
export interface LawMapStatement {
  key: string
  territoryId: string
  actWorkId: string
  actTitle: string
  provision: string | null
  validFrom: string | null
  cells: LawMapCell[]
  deviations: LawMapDeviation[]
  sources: LawMapSource[]
  sourceKind: SourceKind
  review: ReviewState
  recordIds: string[]
}

export interface LawMap {
  countryId: string
  territories: ReadonlyMap<string, LawMapTerritory>
  /** The country itself, or the topmost regions the request holds when it holds no country record. */
  rootIds: string[]
  topics: LawMapTopic[]
  editions: ReadonlyMap<string, LawMapEdition>
  statutes: LawMapStatute[]
  statements: LawMapStatement[]
}

type Body = Record<string, unknown>

const bodyOfRevision = (revision: RevisionView): Body => Object.fromEntries(revision.claims.map((claim) => [claim.path, claim.value]))

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

function reviewOf(revisions: readonly RevisionView[]): ReviewState {
  const decisions = revisions.flatMap((revision) => revision.claims.map((claim) => claim.decision))
  if (decisions.some((decision) => decision === 'rejected')) return 'rejected'
  if (decisions.length > 0 && decisions.every((decision) => decision === 'accepted' || decision === 'edited')) return 'accepted'
  return 'open'
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Every http(s) address among a work's identifiers (its ELI, a database link). */
function identifierUrls(body: Body): string[] {
  const identifiers = body.identifiers
  if (!identifiers || typeof identifiers !== 'object') return []
  return Object.values(identifiers as Record<string, unknown>).filter((value): value is string => typeof value === 'string' && /^https?:\/\//.test(value))
}

/** A natural order for designations: `RL 2` before `RL 2.1` before `RL 10`. */
const byDesignation = (a: { designation: string }, b: { designation: string }): number =>
  a.designation.localeCompare(b.designation, undefined, { numeric: true, sensitivity: 'base' })

function territoriesOf(revisions: readonly RevisionView[]): Map<string, LawMapTerritory> {
  const territories = new Map<string, LawMapTerritory>()
  for (const revision of revisions.filter((one) => one.type === 'territory')) {
    const body = bodyOfRevision(revision)
    const parents = Array.isArray(body.parents) ? (body.parents as { id?: unknown; validFrom?: unknown; validTo?: unknown }[]) : []
    // The tree follows the parent without dates: a union a country joined on a day is not where it sits.
    const parent = parents.find((one) => !one.validFrom && !one.validTo) ?? null
    territories.set(revision.recordId, {
      id: revision.recordId,
      name: text(body.name) ?? revision.recordId,
      kind: text(body.kind) ?? 'territory',
      parentId: parent && typeof parent.id === 'string' ? parent.id : null,
      children: [],
    })
  }
  for (const territory of territories.values()) {
    const parent = territory.parentId ? territories.get(territory.parentId) : undefined
    if (parent) parent.children.push(territory.id)
  }
  for (const territory of territories.values()) territory.children.sort((a, b) => (territories.get(a)?.name ?? a).localeCompare(territories.get(b)?.name ?? b))
  return territories
}

interface Indexed {
  works: Map<string, { revision: RevisionView; body: Body }>
  editions: Map<string, LawMapEdition>
  editionRevisions: Map<string, RevisionView>
}

function indexWorksAndEditions(revisions: readonly RevisionView[]): Indexed {
  const works = new Map<string, { revision: RevisionView; body: Body }>()
  const editions = new Map<string, LawMapEdition>()
  const editionRevisions = new Map<string, RevisionView>()
  for (const revision of revisions) {
    if (revision.type === 'work') works.set(revision.recordId, { revision, body: bodyOfRevision(revision) })
    if (revision.type === 'edition') {
      const body = bodyOfRevision(revision)
      editions.set(revision.recordId, { id: revision.recordId, workId: text(body.workId) ?? '', label: text(body.label) ?? revision.recordId, issuedOn: text(body.issuedOn) })
      editionRevisions.set(revision.recordId, revision)
    }
  }
  return { works, editions, editionRevisions }
}

const designationOf = (body: Body, fallback: string): string => {
  const identifiers = body.identifiers as Record<string, unknown> | undefined
  return text(identifiers?.designation) ?? text(body.title) ?? fallback
}

function sourcesOf(revision: RevisionView, captures: ReadonlyMap<string, CaptureView>): LawMapSource[] {
  return revision.citations.flatMap((citation) => {
    const url = citation.url ?? (citation.captureId ? captures.get(citation.captureId)?.url : undefined) ?? null
    return url ? [{ url, quote: citation.quote ?? null, note: citation.note ?? null }] : []
  })
}

function statementsOf(revisions: readonly RevisionView[], indexed: Indexed, captures: ReadonlyMap<string, CaptureView>): LawMapStatement[] {
  const relations = revisions.filter((revision) => revision.type === 'relation').map((revision) => ({ revision, body: bodyOfRevision(revision) }))
  const primaryHosts = new Map<string, Set<string>>()
  for (const { body } of indexed.works.values()) {
    const hosts = identifierUrls(body).map(hostOf).filter((host): host is string => host !== null)
    for (const territoryId of (body.territoryIds as string[] | undefined) ?? []) {
      const known = primaryHosts.get(territoryId) ?? new Set<string>()
      hosts.forEach((host) => known.add(host))
      primaryHosts.set(territoryId, known)
    }
  }
  const groups = new Map<string, { territoryId: string; actWorkId: string; validFrom: string | null; members: typeof relations }>()
  for (const relation of relations.filter(({ body }) => body.relationType === 'makes_binding' && body.toType === 'edition')) {
    const actWorkId = text(relation.body.fromId) ?? ''
    const territoryId = ((indexed.works.get(actWorkId)?.body.territoryIds as string[] | undefined) ?? [])[0] ?? ''
    const validFrom = text(relation.body.validFrom)
    const key = `${actWorkId}|${validFrom ?? ''}`
    const group = groups.get(key) ?? { territoryId, actWorkId, validFrom, members: [] }
    group.members.push(relation)
    groups.set(key, group)
  }
  const deviations = relations.filter(({ body }) => body.relationType === 'deviates_from')
  return [...groups.entries()].map(([key, group]) => {
    const act = indexed.works.get(group.actWorkId)
    const own = deviations.filter(({ body }) => body.fromId === group.actWorkId && text(body.validFrom) === group.validFrom)
    const members = [...group.members, ...own]
    const sources = members.flatMap(({ revision }) => sourcesOf(revision, captures))
    const unique = [...new Map(sources.map((source) => [`${source.url}|${source.quote ?? ''}`, source])).values()]
    const hosts = primaryHosts.get(group.territoryId) ?? new Set<string>()
    const sourceKind: SourceKind = unique.length === 0 ? 'none' : unique.some((source) => hosts.has(hostOf(source.url) ?? '')) ? 'primary' : 'secondary'
    const provisions = members.map(({ body }) => text(body.provision)).filter((one): one is string => one !== null)
    return {
      key,
      territoryId: group.territoryId,
      actWorkId: group.actWorkId,
      actTitle: act ? text(act.body.title) ?? group.actWorkId : group.actWorkId,
      provision: provisions.sort((a, b) => a.length - b.length)[0] ?? null,
      validFrom: group.validFrom,
      cells: group.members.map(({ revision, body }) => ({
        relationId: revision.recordId,
        editionId: text(body.toId) ?? '',
        topicWorkId: indexed.editions.get(text(body.toId) ?? '')?.workId ?? '',
        validFrom: text(body.validFrom),
        validTo: text(body.validTo),
      })),
      deviations: own.map(({ revision, body }) => ({
        relationId: revision.recordId,
        editionId: text(body.toId) ?? '',
        provision: text(body.provision),
        anchors: Array.isArray(body.anchors) ? (body.anchors as { to?: string; from?: string }[]).map((anchor) => anchor.to ?? anchor.from ?? '').filter(Boolean) : [],
      })),
      sources: unique,
      sourceKind,
      review: reviewOf(members.map(({ revision }) => revision)),
      recordIds: members.map(({ revision }) => revision.recordId),
    }
  })
}

/** The law map of the records a change request holds, for one country. */
export function lawMapOf(countryId: string, revisions: readonly RevisionView[], captures: readonly CaptureView[]): LawMap {
  const territories = territoriesOf(revisions)
  const indexed = indexWorksAndEditions(revisions)
  const captureById = new Map(captures.map((capture) => [capture.captureId, capture]))
  const statements = statementsOf(revisions, indexed, captureById).sort(
    (a, b) => (territories.get(a.territoryId)?.name ?? a.territoryId).localeCompare(territories.get(b.territoryId)?.name ?? b.territoryId) || (a.validFrom ?? '').localeCompare(b.validFrom ?? ''),
  )
  const topicIds = new Set(statements.flatMap((statement) => statement.cells.map((cell) => cell.topicWorkId)).filter(Boolean))
  const topics = [...topicIds]
    .map((workId) => {
      const work = indexed.works.get(workId)
      return { workId, designation: work ? designationOf(work.body, workId) : workId, title: work ? text(work.body.title) ?? '' : '' }
    })
    .sort(byDesignation)
  const actIds = new Set(statements.map((statement) => statement.actWorkId))
  const statutes = [...indexed.works.values()]
    .filter(({ body, revision }) => body.kind === 'statute' && !actIds.has(revision.recordId) && !topicIds.has(revision.recordId))
    .flatMap(({ body, revision }) =>
      ((body.territoryIds as string[] | undefined) ?? []).map((territoryId) => ({
        workId: revision.recordId,
        territoryId,
        title: text(body.title) ?? revision.recordId,
        designation: designationOf(body, revision.recordId),
        url: identifierUrls(body)[0] ?? null,
        review: reviewOf([revision]),
      })),
    )
  const rootIds = territories.has(countryId) ? [countryId] : [...territories.values()].filter((territory) => !territory.parentId || !territories.has(territory.parentId)).map((territory) => territory.id)
  return { countryId, territories, rootIds, topics, editions: indexed.editions, statutes, statements }
}

/** The cell that binds for a topic in a region on a day, with its statement; half-open intervals. */
export function bindingOn(map: LawMap, territoryId: string, topicWorkId: string, date: string): { cell: LawMapCell; statement: LawMapStatement } | null {
  for (const statement of map.statements) {
    if (statement.territoryId !== territoryId) continue
    for (const cell of statement.cells) {
      if (cell.topicWorkId !== topicWorkId) continue
      if ((cell.validFrom ?? '') <= date && (cell.validTo === null || date < cell.validTo)) return { cell, statement }
    }
  }
  return null
}

/** How many statements under a territory (itself and below) are open, accepted or rejected. */
export function reviewCounts(map: LawMap, territoryId: string): Record<ReviewState, number> {
  const under = new Set<string>()
  const walk = (id: string): void => {
    under.add(id)
    map.territories.get(id)?.children.forEach(walk)
  }
  walk(territoryId)
  const counts: Record<ReviewState, number> = { accepted: 0, rejected: 0, open: 0 }
  for (const statement of map.statements) if (under.has(statement.territoryId)) counts[statement.review] += 1
  return counts
}
