/**
 * What one confirmation in the law map covers (country-onboarding-ux.md, C2):
 * an adoption statement with the act it names, an edition with its text, a
 * region's building act, a series, the imported regions, or any other record
 * of the request. A confirmation is the existing review verdict on each of
 * those records' claims, sent through the review route in batches; approval,
 * four eyes and the source check stay where they are (`decide.ts`, the
 * migrations' triggers). Pure.
 */

import { reviewOf, type LawMap, type ReviewState } from './law-map'
import type { ChangeRequestView, ReviewDecisionBody, RevisionView } from './wire'

export type ReviewUnitKind = 'regions' | 'statement' | 'statute' | 'series' | 'edition' | 'text' | 'record'

export interface ReviewUnit {
  key: string
  kind: ReviewUnitKind
  /** The record a `record` unit is, for its row; empty for the others, whose rows name them. */
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
  const manifestations = view.revisions.filter((revision) => revision.type === 'manifestation')
  // A work's record is the statute's when it is one (taken above), else its series row's; every edition gets its own row.
  for (const topic of [...map.topics, ...map.otherWorks]) {
    add(`series:${topic.workId}`, 'series', [topic.workId])
    for (const edition of [...map.editions.values()].filter((one) => one.workId === topic.workId)) {
      const texts = manifestations.filter((revision) => revision.claims.some((claim) => claim.path === 'editionId' && claim.value === edition.id)).map((revision) => revision.recordId)
      add(`edition:${edition.id}`, 'edition', [edition.id, ...texts])
    }
  }
  for (const loose of map.looseTexts) add(`text:${loose.recordId}`, 'text', [loose.recordId])
  add('regions', 'regions', [...map.territories.keys()])
  for (const revision of view.revisions) if (!taken.has(revision.recordId)) add(`record:${revision.recordId}`, 'record', [revision.recordId], nameOf(revision))
  return units
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
