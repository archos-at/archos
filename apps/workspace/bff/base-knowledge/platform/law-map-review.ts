/**
 * What one confirmation in the law map covers (country-onboarding-ux.md, C2),
 * grouped by what a person decides rather than by record: an adoption
 * statement with the act it names, a region's building act, the imported
 * regions in one, a guideline series' editions of one year with their works
 * and texts in one ("OIB-RL 2023: 9 editions, 9 texts"), and every other kind
 * of record in one per kind (the sources, the rules, the test questions). A confirmation is the existing review verdict on each of
 * those records' claims, sent through the review route in batches; approval,
 * four eyes and the source check stay where they are (`decide.ts`, the
 * migrations' triggers). Pure.
 */

import { editionOrder, reviewOf, type LawMap, type ReviewState } from './law-map'
import type { ChangeRequestView, ReviewDecisionBody, RevisionView } from './wire'

export type ReviewUnitKind = 'regions' | 'statement' | 'statute' | 'batch' | 'kind'

export interface ReviewUnit {
  key: string
  kind: ReviewUnitKind
  /** A batch's name ("OIB-RL 2023") or a kind unit's record type; empty for the others, whose rows name them. */
  label: string
  revisions: RevisionView[]
  review: ReviewState
  /** Who wrote its revisions: a confirmation by one of them needs one operator alone (dev) or waits for another person. */
  authors: string[]
  /** The revisions that cite a page or name a text nobody fetched: only their claims carry the reviewer's source check. */
  uncheckedRevisionIds: string[]
  /** Those pages, for the reviewer to compare against before saying so. */
  uncheckedSources: { url: string; quote: string | null }[]
}

/** The review route takes at most this many verdicts per call (`reviewBodySchema`). */
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
  // Per record, as the old review and the triggers (0218, 0233) decide it.
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

/** A work's short name: its designation, else its title. */
function designationOf(revision: RevisionView | undefined): string {
  if (!revision) return ''
  const identifiers = claimOf(revision, 'identifiers')
  const designation = identifiers && typeof identifiers === 'object' ? (identifiers as Record<string, unknown>).designation : null
  return typeof designation === 'string' && designation ? designation : nameOf(revision)
}

/** The series a designation belongs to: "OIB-RL 2.1" and "OIB-RL 6" are both "OIB-RL". */
export const seriesOf = (designation: string): string => designation.replace(/[\s-]*\d[\d.]*[a-z]?\s*$/i, '').trim() || designation

/** An edition's year, from its issue day or its label; the label when it names none. */
const yearOf = (revision: RevisionView): string => {
  const order = editionOrder({ issuedOn: typeof claimOf(revision, 'issuedOn') === 'string' ? (claimOf(revision, 'issuedOn') as string) : null, label: String(claimOf(revision, 'label') ?? '') } as Parameters<typeof editionOrder>[0])
  return /^\d{4}/.test(order) ? order.slice(0, 4) : order
}

/** Every unit of the request, each record in exactly one, in the order the outline shows them. */
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
  for (const batch of batchesOf(view.revisions, taken)) add(`batch:${batch.label}`, 'batch', batch.ids, batch.label)
  const kinds = [...new Set(view.revisions.filter((revision) => !taken.has(revision.recordId)).map((revision) => revision.type))]
  for (const type of kinds) add(`kind:${type}`, 'kind', view.revisions.filter((revision) => revision.type === type).map((revision) => revision.recordId), type)
  return units
}

/**
 * The editions not yet in a unit, by series and year, each with its texts and
 * the works whose newest edition it holds: one decision ("these are the 2023
 * guidelines, and these files are their texts") for what a publisher issued together.
 */
function batchesOf(revisions: readonly RevisionView[], taken: ReadonlySet<string>): { label: string; ids: string[] }[] {
  const byRecord = new Map(revisions.map((revision) => [revision.recordId, revision]))
  const editions = revisions.filter((revision) => revision.type === 'edition' && !taken.has(revision.recordId))
  const batches = new Map<string, string[]>()
  const newest = new Map<string, { year: string; label: string }>()
  for (const edition of editions) {
    const workId = String(claimOf(edition, 'workId') ?? '')
    const year = yearOf(edition)
    const label = `${seriesOf(designationOf(byRecord.get(workId)) || workId)} ${year}`.trim()
    const texts = revisions.filter((revision) => revision.type === 'manifestation' && claimOf(revision, 'editionId') === edition.recordId).map((revision) => revision.recordId)
    batches.set(label, [...(batches.get(label) ?? []), edition.recordId, ...texts])
    if (!newest.has(workId) || (newest.get(workId)?.year ?? '') < year) newest.set(workId, { year, label })
  }
  for (const [workId, { label }] of newest) if (byRecord.has(workId) && !taken.has(workId)) batches.get(label)?.unshift(workId)
  return [...batches.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, ids]) => ({ label, ids }))
}

/** The review calls that give one verdict on every claim of a unit not yet carrying it, at most `VERDICTS_PER_CALL` each. */
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
        // The check is said only of a record whose page or text nobody fetched, never of the rest of the unit.
        sourceChecked: decision === 'accepted' && Boolean(options.sourceChecked) && unchecked.has(revision.revisionId),
      })),
  )
  const calls: ReviewDecisionBody[] = []
  for (let start = 0; start < decisions.length; start += VERDICTS_PER_CALL) calls.push({ decisions: decisions.slice(start, start + VERDICTS_PER_CALL) })
  return calls
}
