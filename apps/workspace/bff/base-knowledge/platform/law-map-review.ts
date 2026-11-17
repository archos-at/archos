import { editionOrder, reviewOf, type LawMap, type ReviewState } from './law-map'
import type { ChangeRequestView, ReviewDecisionBody, RevisionView } from './wire'

export type ReviewUnitKind = 'regions' | 'statement' | 'statute' | 'batch' | 'kind'

export interface ReviewUnit {
  key: string
  kind: ReviewUnitKind
  label: string
  revisions: RevisionView[]
  review: ReviewState
  authors: string[]
  uncheckedRevisionIds: string[]
  uncheckedSources: { url: string; quote: string | null }[]
}

export const VERDICTS_PER_CALL = 500

type View = Pick<ChangeRequestView, 'revisions' | 'captures' | 'texts'>

const nameOf = (revision: RevisionView): string => {
  const claim = (path: string) => revision.claims.find((one) => one.path === path)?.value
  const named = [claim('title'), claim('name'), claim('label'), claim('question')].find((value): value is string => typeof value === 'string' && value.length > 0)
  return named ?? revision.recordId
}

function unit(key: string, kind: ReviewUnitKind, revisions: RevisionView[], view: View, label = ''): ReviewUnit {
  const unfetched = new Map((view.captures ?? []).filter((capture) => !capture.countsAsFetched).map((capture) => [capture.captureId, capture]))
  const unfetchedTexts = new Map((view.texts ?? []).filter((text) => text.countsAsFetched === false).map((text) => [text.recordId, text]))
  const unchecked = revisions.filter((revision) => unfetchedTexts.has(revision.recordId) || revision.citations.some((citation) => citation.captureId && unfetched.has(citation.captureId)))
  const sources = unchecked.flatMap((revision) => [
    ...revision.citations.flatMap((citation) => {
      const capture = citation.captureId ? unfetched.get(citation.captureId) : undefined
      return capture ? [{ url: capture.url, quote: citation.quote ?? null }] : []
    }),
    ...(unfetchedTexts.has(revision.recordId) ? [{ url: unfetchedTexts.get(revision.recordId)?.corpusFile ?? revision.recordId, quote: null }] : []),
  ])
  return {
    key,
    kind,
    label,
    revisions,
    review: reviewOf(revisions),
    authors: [...new Set(revisions.map((revision) => revision.createdBy))],
    uncheckedRevisionIds: unchecked.map((revision) => revision.revisionId),
    uncheckedSources: [...new Map(sources.map((source) => [`${source.url}|${source.quote ?? ''}`, source])).values()],
  }
}

const claimOf = (revision: RevisionView, path: string): unknown => revision.claims.find((claim) => claim.path === path)?.value

function designationOf(revision: RevisionView | undefined): string {
  if (!revision) return ''
  const identifiers = claimOf(revision, 'identifiers')
  const designation = identifiers && typeof identifiers === 'object' ? (identifiers as Record<string, unknown>).designation : null
  return typeof designation === 'string' && designation ? designation : nameOf(revision)
}

export const seriesOf = (designation: string): string => designation.replace(/[\s-]*\d[\d.]*[a-z]?\s*$/i, '').trim() || designation

const yearOf = (revision: RevisionView): string => {
  const order = editionOrder({ issuedOn: typeof claimOf(revision, 'issuedOn') === 'string' ? (claimOf(revision, 'issuedOn') as string) : null, label: String(claimOf(revision, 'label') ?? '') } as Parameters<typeof editionOrder>[0])
  return /^\d{4}/.test(order) ? order.slice(0, 4) : order
}

export function reviewUnitsOf(map: LawMap, view: View): ReviewUnit[] {
  const byRecord = new Map(view.revisions.map((revision) => [revision.recordId, revision]))
  const taken = new Set<string>()
  const take = (ids: readonly string[]): RevisionView[] =>
    ids.flatMap((id) => {
      const revision = byRecord.get(id)
      if (!revision || taken.has(id)) return []
      taken.add(id)
      return [revision]
    })
  const units: ReviewUnit[] = []
  const add = (key: string, kind: ReviewUnitKind, ids: readonly string[], label = ''): void => {
    const revisions = take(ids)
    if (revisions.length > 0) units.push(unit(key, kind, revisions, view, label))
  }
  for (const statement of map.statements) add(statement.key, 'statement', [...statement.recordIds, statement.actWorkId])
  for (const statute of map.statutes) add(`statute:${statute.workId}`, 'statute', [statute.workId])
  add('regions', 'regions', [...map.territories.keys()])
  for (const batch of batchesOf(view.revisions, taken, view.captures)) add(`batch:${batch.label}`, 'batch', batch.ids, batch.label)
  const kinds = [...new Set(view.revisions.filter((revision) => !taken.has(revision.recordId)).map((revision) => revision.type))]
  for (const type of kinds) add(`kind:${type}`, 'kind', view.revisions.filter((revision) => revision.type === type).map((revision) => revision.recordId), type)
  return units
}

function batchesOf(revisions: readonly RevisionView[], taken: ReadonlySet<string>, captures: View['captures']): { label: string; ids: string[] }[] {
  const byRecord = new Map(revisions.map((revision) => [revision.recordId, revision]))
  const captureUrl = new Map((captures ?? []).map((capture) => [capture.captureId, capture.url]))
  const hostsOf = (revision: RevisionView): string[] =>
    revision.citations.flatMap((citation) => {
      const url = citation.url ?? (citation.captureId ? captureUrl.get(citation.captureId) : undefined)
      if (!url) return []
      try {
        return [new URL(url).hostname]
      } catch {
        return []
      }
    })
  const editions = revisions.filter((revision) => revision.type === 'edition' && !taken.has(revision.recordId))
  const textsOf = (edition: RevisionView) => revisions.filter((revision) => revision.type === 'manifestation' && claimOf(revision, 'editionId') === edition.recordId)
  const parent = editions.map((_, index) => index)
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index] ?? index)))
  const seen = new Map<string, number>()
  const info = editions.map((edition, index) => {
    const workId = String(claimOf(edition, 'workId') ?? '')
    const work = byRecord.get(workId)
    const identifiers = work ? claimOf(work, 'identifiers') : null
    const designated = Boolean(identifiers && typeof identifiers === 'object' && typeof (identifiers as Record<string, unknown>).designation === 'string')
    const series = designated ? seriesOf(designationOf(work)) : null
    const issuer = work && typeof claimOf(work, 'issuer') === 'string' ? String(claimOf(work, 'issuer')) : null
    const year = yearOf(edition)
    const marks = [issuer && `issuer:${issuer}`, series && `series:${series}`, ...textsOf(edition).flatMap(hostsOf).map((host) => `host:${host}`)].filter((mark): mark is string => Boolean(mark))
    for (const mark of marks.length > 0 ? marks : [`work:${workId}`]) {
      const other = seen.get(`${year}|${mark}`)
      if (other === undefined) seen.set(`${year}|${mark}`, index)
      else parent[root(index)] = root(other)
    }
    return { workId, series, year }
  })
  const batches = new Map<number, { ids: string[]; series: Map<string, number>; year: string; fallback: string }>()
  const newest = new Map<string, { year: string; at: number }>()
  editions.forEach((edition, index) => {
    const { workId, series, year } = info[index]!
    const at = root(index)
    const batch = batches.get(at) ?? { ids: [], series: new Map<string, number>(), year, fallback: designationOf(byRecord.get(workId)) || workId }
    if (series) batch.series.set(series, (batch.series.get(series) ?? 0) + 1)
    batch.ids.push(edition.recordId, ...textsOf(edition).map((revision) => revision.recordId))
    batches.set(at, batch)
    if (!newest.has(workId) || (newest.get(workId)?.year ?? '') < year) newest.set(workId, { year, at })
  })
  for (const [workId, { at }] of newest) if (byRecord.has(workId) && !taken.has(workId)) batches.get(at)?.ids.unshift(workId)
  return [...batches.values()]
    .map((batch) => ({ label: `${[...batch.series.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? batch.fallback} ${batch.year}`.trim(), ids: batch.ids }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((batch, index, all) => (all.findIndex((one) => one.label === batch.label) === index ? batch : { ...batch, label: `${batch.label} (${index + 1})` }))
}

export function verdictCalls(target: ReviewUnit, decision: 'accepted' | 'rejected', options: { note?: string; sourceChecked?: boolean } = {}): ReviewDecisionBody[] {
  const unchecked = new Set(target.uncheckedRevisionIds)
  const decisions = target.revisions.flatMap((revision) =>
    revision.claims
      .filter((claim) => claim.decision !== decision)
      .map((claim) => ({
        revisionId: revision.revisionId,
        claimPath: claim.path,
        decision,
        ...(options.note ? { note: options.note } : {}),
        sourceChecked: decision === 'accepted' && Boolean(options.sourceChecked) && unchecked.has(revision.revisionId),
      })),
  )
  const calls: ReviewDecisionBody[] = []
  for (let start = 0; start < decisions.length; start += VERDICTS_PER_CALL) calls.push({ decisions: decisions.slice(start, start + VERDICTS_PER_CALL) })
  return calls
}
