import type { CaptureView, RevisionView } from './wire'

export type ReviewState = 'accepted' | 'rejected' | 'open'

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
  text: { file: string | null; url: string | null } | null
  review: ReviewState
}

export interface LawMapTopic {
  workId: string
  designation: string
  title: string
}

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
  rootIds: string[]
  topics: LawMapTopic[]
  editions: ReadonlyMap<string, LawMapEdition>
  statutes: LawMapStatute[]
  statements: LawMapStatement[]
}

type Body = Record<string, unknown>

const bodyOfRevision = (revision: RevisionView): Body => Object.fromEntries(revision.claims.map((claim) => [claim.path, claim.value]))

const LEGAL_ACT_KINDS: ReadonlySet<string> = new Set(['statute', 'ordinance', 'administrative_regulation'])

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

export function reviewOf(revisions: readonly RevisionView[]): ReviewState {
  const decisions = revisions.flatMap((revision) => revision.claims.map((claim) => claim.decision))
  if (decisions.some((decision) => decision === 'rejected')) return 'rejected'
  if (decisions.every((decision) => decision === 'accepted')) return 'accepted'
  return 'open'
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function onSite(host: string | null, sites: ReadonlySet<string>): boolean {
  if (!host) return false
  return [...sites].some((site) => {
    const base = site.replace(/^www\./, '')
    return host === site || host === base || host.endsWith(`.${base}`)
  })
}

function actUrls(body: Body, revision: RevisionView, captures: ReadonlyMap<string, CaptureView>): string[] {
  return [...identifierUrls(body), ...revision.citations.map((citation) => citedUrl(citation, captures)).filter((url): url is string => url !== null)]
}

function identifierUrls(body: Body): string[] {
  const identifiers = body.identifiers
  if (!identifiers || typeof identifiers !== 'object') return []
  return Object.values(identifiers as Record<string, unknown>).filter((value): value is string => typeof value === 'string' && /^https?:\/\//.test(value))
}

const byDesignation = (a: { designation: string }, b: { designation: string }): number =>
  a.designation.localeCompare(b.designation, undefined, { numeric: true, sensitivity: 'base' })

function territoriesOf(revisions: readonly RevisionView[]): Map<string, LawMapTerritory> {
  const territories = new Map<string, LawMapTerritory>()
  for (const revision of revisions.filter((one) => one.type === 'territory')) {
    const body = bodyOfRevision(revision)
    const parents = Array.isArray(body.parents) ? (body.parents as { id?: unknown; validFrom?: unknown; validTo?: unknown }[]) : []
    const kind = text(body.kind) ?? 'territory'
    const dated = kind === 'country' || kind === 'union' ? [] : [...parents].sort((a, b) => String(b.validFrom ?? '').localeCompare(String(a.validFrom ?? '')))
    const parent = parents.find((one) => !one.validFrom && !one.validTo) ?? dated[0] ?? null
    territories.set(revision.recordId, {
      id: revision.recordId,
      name: text(body.name) ?? revision.recordId,
      kind,
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

const citedUrl = (citation: RevisionView['citations'][number], captures: ReadonlyMap<string, CaptureView>): string | null =>
  citation.url ?? (citation.captureId ? captures.get(citation.captureId)?.url : undefined) ?? null

function indexWorksAndEditions(revisions: readonly RevisionView[], captures: ReadonlyMap<string, CaptureView>): Indexed {
  const works = new Map<string, { revision: RevisionView; body: Body }>()
  const editions = new Map<string, LawMapEdition>()
  const editionRevisions = new Map<string, RevisionView>()
  for (const revision of revisions) {
    if (revision.type === 'work') works.set(revision.recordId, { revision, body: bodyOfRevision(revision) })
    if (revision.type === 'edition') {
      const body = bodyOfRevision(revision)
      editions.set(revision.recordId, { id: revision.recordId, workId: text(body.workId) ?? '', label: text(body.label) ?? revision.recordId, issuedOn: text(body.issuedOn), text: null, review: reviewOf([revision]) })
      editionRevisions.set(revision.recordId, revision)
    }
  }
  const manifestations = revisions.filter((one) => one.type === 'manifestation').sort((a, b) => a.recordId.localeCompare(b.recordId))
  const byEdition = new Map<string, RevisionView[]>()
  for (const revision of manifestations) {
    const editionId = text(bodyOfRevision(revision).editionId) ?? ''
    if (editions.has(editionId)) byEdition.set(editionId, [...(byEdition.get(editionId) ?? []), revision])
  }
  for (const [editionId, texts] of byEdition) {
    const edition = editions.get(editionId)
    const first = texts[0]
    if (!edition || !first) continue
    const url = first.citations.map((citation) => citedUrl(citation, captures)).find((one) => one !== null) ?? null
    edition.text = { file: text(bodyOfRevision(first).corpusFile), url }
    const own = editionRevisions.get(editionId)
    edition.review = reviewOf(own ? [own, ...texts] : texts)
  }
  return { works, editions, editionRevisions }
}

const designationOf = (body: Body, fallback: string): string => {
  const identifiers = body.identifiers as Record<string, unknown> | undefined
  return text(identifiers?.designation) ?? text(body.title) ?? fallback
}

function sourcesOf(revision: RevisionView, captures: ReadonlyMap<string, CaptureView>): LawMapSource[] {
  return revision.citations.flatMap((citation) => {
    const url = citedUrl(citation, captures)
    return url ? [{ url, quote: citation.quote ?? null, note: citation.note ?? null }] : []
  })
}

function statementsOf(revisions: readonly RevisionView[], indexed: Indexed, captures: ReadonlyMap<string, CaptureView>): LawMapStatement[] {
  const relations = revisions.filter((revision) => revision.type === 'relation').map((revision) => ({ revision, body: bodyOfRevision(revision) }))
  const primaryHosts = new Map<string, Set<string>>()
  for (const { body, revision } of indexed.works.values()) {
    if (!LEGAL_ACT_KINDS.has(text(body.kind) ?? '')) continue
    const hosts = actUrls(body, revision, captures).map(hostOf).filter((host): host is string => host !== null)
    for (const territoryId of (body.territoryIds as string[] | undefined) ?? []) {
      const known = primaryHosts.get(territoryId) ?? new Set<string>()
      hosts.forEach((host) => known.add(host))
      primaryHosts.set(territoryId, known)
    }
  }
  const groups = new Map<string, { territoryId: string; actWorkId: string; validFrom: string | null; members: typeof relations }>()
  for (const relation of relations.filter(({ body }) => body.relationType === 'makes_binding' && body.toType === 'edition')) {
    const actWorkId = text(relation.body.fromId) ?? ''
    const territoryIds = (indexed.works.get(actWorkId)?.body.territoryIds as string[] | undefined) ?? []
    const validFrom = text(relation.body.validFrom)
    for (const territoryId of territoryIds.length > 0 ? territoryIds : ['']) {
      const key = territoryIds.length > 1 ? `${actWorkId}|${validFrom ?? ''}|${territoryId}` : `${actWorkId}|${validFrom ?? ''}`
      const group = groups.get(key) ?? { territoryId, actWorkId, validFrom, members: [] }
      group.members.push(relation)
      groups.set(key, group)
    }
  }
  const deviations = relations.filter(({ body }) => body.relationType === 'deviates_from')
  return [...groups.entries()].map(([key, group]) => {
    const act = indexed.works.get(group.actWorkId)
    const own = deviations.filter(({ body }) => body.fromId === group.actWorkId && text(body.validFrom) === group.validFrom)
    const members = [...group.members, ...own]
    const sources = members.flatMap(({ revision }) => sourcesOf(revision, captures))
    const unique = [...new Map(sources.map((source) => [`${source.url}|${source.quote ?? ''}`, source])).values()]
    const hosts = primaryHosts.get(group.territoryId) ?? new Set<string>()
    const sourceKind: SourceKind = unique.length === 0 ? 'none' : unique.some((source) => onSite(hostOf(source.url), hosts)) ? 'primary' : 'secondary'
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

export function lawMapOf(countryId: string, revisions: readonly RevisionView[], captures: readonly CaptureView[]): LawMap {
  const territories = territoriesOf(revisions)
  const captureById = new Map(captures.map((capture) => [capture.captureId, capture]))
  const indexed = indexWorksAndEditions(revisions, captureById)
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
        url: actUrls(body, revision, captureById)[0] ?? null,
        review: reviewOf([revision]),
      })),
    )
  const rootIds = territories.has(countryId) ? [countryId] : [...territories.values()].filter((territory) => !territory.parentId || !territories.has(territory.parentId)).map((territory) => territory.id)
  return { countryId, territories, rootIds, topics, editions: indexed.editions, statutes, statements }
}

export function bindingOn(map: LawMap, territoryId: string, topicWorkId: string, date: string): { cell: LawMapCell; statement: LawMapStatement } | null {
  let found: { cell: LawMapCell; statement: LawMapStatement } | null = null
  for (const statement of map.statements) {
    if (statement.territoryId !== territoryId || statement.review === 'rejected') continue
    for (const cell of statement.cells) {
      if (cell.topicWorkId !== topicWorkId) continue
      if ((cell.validFrom ?? '') > date || (cell.validTo !== null && date >= cell.validTo)) continue
      if (!found || (cell.validFrom ?? '') > (found.cell.validFrom ?? '')) found = { cell, statement }
    }
  }
  return found
}

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

export function summaryOn(map: LawMap, territoryId: string, date: string): { main: LawMapEdition | null; exceptions: { topic: LawMapTopic; edition: LawMapEdition }[] } {
  const bound = map.topics.flatMap((topic) => {
    const binding = bindingOn(map, territoryId, topic.workId, date)
    const edition = binding ? map.editions.get(binding.cell.editionId) : undefined
    return edition ? [{ topic, edition }] : []
  })
  return summaryOf(bound)
}

export function editionOrder(edition: LawMapEdition): string {
  return edition.issuedOn ?? edition.label.match(/\b(1[89]|20)\d{2}\b/)?.[0] ?? edition.label
}

export function summaryOf<T extends { edition: LawMapEdition }>(bound: readonly T[]): { main: LawMapEdition | null; exceptions: T[] } {
  const counts = new Map<string, number>()
  for (const { edition } of bound) counts.set(edition.label, (counts.get(edition.label) ?? 0) + 1)
  const label = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const main = bound.find(({ edition }) => edition.label === label)?.edition ?? null
  return { main, exceptions: bound.filter(({ edition }) => edition.label !== label) }
}

export function nextChange(map: LawMap, territoryId: string, date: string): LawMapStatement | null {
  return map.statements.filter((statement) => statement.territoryId === territoryId && statement.review !== 'rejected' && (statement.validFrom ?? '') > date).sort((a, b) => (a.validFrom ?? '').localeCompare(b.validFrom ?? ''))[0] ?? null
}
