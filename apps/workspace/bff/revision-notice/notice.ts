import { v5 as uuidv5 } from 'uuid'
import { MAX_ANNOTATION_BASIS, MAX_ANNOTATION_BODY, MAX_PROPOSALS_PER_CALL, type AnnotationProposal } from '@/lib/annotations/types'
import type { CompareRegion, RevisionVisualChanges } from '@/lib/documents/revision-compare-types'
import { PRODUCT_NAME } from '@/lib/brand'
import { isAgentKind } from '@/lib/agent-kind'

export const DEFAULT_MAX_PAGES = 3
export const MAX_PAGES_CEILING = 10
export const DEFAULT_DELAY_SECONDS = 120
const MAX_DELAY_SECONDS = 3600

export function revisionNoticeId(newerId: string, olderId: string): string {
  return uuidv5(`grid:revision-notice:${newerId}:${olderId}`, uuidv5.URL)
}

export function revisionNoticeMessageId(noticeId: string): string {
  return uuidv5(`grid:revision-notice-message:${noticeId}`, uuidv5.URL)
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function maxNoticePages(env: Record<string, string | undefined> = process.env): number {
  return boundedInt(env.REVISION_NOTICE_MAX_PAGES, DEFAULT_MAX_PAGES, 1, MAX_PAGES_CEILING)
}

export function noticeDelaySeconds(env: Record<string, string | undefined> = process.env): number {
  return boundedInt(env.REVISION_NOTICE_DELAY_SECONDS, DEFAULT_DELAY_SECONDS, 0, MAX_DELAY_SECONDS)
}

export function pagesToCompare(
  changed: { pages: readonly number[]; newerPageCount: number; comparable: boolean },
  maxPages: number,
): { pages: number[]; skipped: number[] } {
  if (!changed.comparable) {
    const count = Math.max(1, Math.min(maxPages, changed.newerPageCount || maxPages))
    return { pages: Array.from({ length: count }, (_, index) => index + 1), skipped: [] }
  }
  const sorted = [...new Set(changed.pages)].sort((a, b) => a - b)
  return { pages: sorted.slice(0, maxPages), skipped: sorted.slice(maxPages) }
}

export interface PageComparison {
  page: number
  changes: RevisionVisualChanges
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`
}

function sentenceFor(changes: RevisionVisualChanges, index: number): string | null {
  if (changes.summary.length !== changes.regions.length) return null
  return changes.summary[index]?.trim() || null
}

export function markBody(region: CompareRegion, sentence: string | null, olderName: string): string {
  const label = region.label.trim().replace(/[.!]+$/, '')
  const said = sentence && sentence.toLowerCase() !== label.toLowerCase() ? ` ${sentence}` : ''
  return clip(`Geändert gegenüber „${clip(olderName, 120)}“: ${label}.${said}`, MAX_ANNOTATION_BODY)
}

export function markBasis(page: number, olderName: string): string {
  return clip(
    `Bildvergleich mit „${clip(olderName, 160)}“, S. ${page}; von ${PRODUCT_NAME} ohne Auftrag vorgeschlagen, nicht geprüft`,
    MAX_ANNOTATION_BASIS,
  )
}

export interface ExistingMark {
  page: number
  x: number
  y: number
  w: number | null
  h: number | null
  body: string
  authorKind: string
}

const samePlace = (mark: ExistingMark, proposal: AnnotationProposal): boolean =>
  isAgentKind(mark.authorKind) &&
  mark.page === proposal.page &&
  mark.body.trim() === proposal.body.trim() &&
  Math.abs(mark.x - proposal.x) < 1e-4 &&
  Math.abs(mark.y - proposal.y) < 1e-4 &&
  Math.abs((mark.w ?? 0) - (proposal.w ?? 0)) < 1e-4 &&
  Math.abs((mark.h ?? 0) - (proposal.h ?? 0)) < 1e-4

export function alreadyProposed<T extends ExistingMark>(
  found: readonly AnnotationProposal[],
  existing: readonly T[],
): T[] {
  const marks: T[] = []
  for (const proposal of found) {
    const mark = existing.find((candidate) => samePlace(candidate, proposal) && !marks.includes(candidate))
    if (mark) marks.push(mark)
  }
  return marks
}

export function proposalsFrom(
  comparisons: readonly PageComparison[],
  olderName: string,
  existing: readonly ExistingMark[] = [],
): AnnotationProposal[] {
  const proposals: AnnotationProposal[] = []
  for (const { page, changes } of [...comparisons].sort((a, b) => a.page - b.page)) {
    changes.regions.forEach((region, index) => {
      const proposal: AnnotationProposal = {
        page,
        shape: 'region',
        x: region.x,
        y: region.y,
        w: Math.min(region.w, 1 - region.x),
        h: Math.min(region.h, 1 - region.y),
        kind: 'hint',
        body: markBody(region, sentenceFor(changes, index), olderName),
        basis: markBasis(page, olderName),
      }
      if (!existing.some((mark) => samePlace(mark, proposal))) proposals.push(proposal)
    })
  }
  return proposals.slice(0, MAX_PROPOSALS_PER_CALL)
}

const pageList = (pages: readonly number[]): string =>
  pages.length === 1 ? `Seite ${pages[0]}` : `Seiten ${pages.join(', ')}`

export function noticeMessage(input: {
  newerName: string
  olderName: string
  compared: readonly number[]
  skipped: readonly number[]
  proposals: readonly AnnotationProposal[]
}): string {
  const { proposals } = input
  const count = proposals.length === 1 ? 'Eine Stelle ist' : `${proposals.length} Stellen sind`
  const lines = [
    `Ich habe die neue Fassung „${input.newerName}“ mit „${input.olderName}“ verglichen (${pageList(input.compared)}). ${count} am Dokument als Vorschlag markiert, noch nicht übernommen:`,
    '',
    ...proposals.map((proposal, index) => `${index + 1}. S. ${proposal.page}: ${proposal.body}`),
  ]
  if (input.skipped.length > 0) {
    lines.push('', `Weitere geänderte ${pageList(input.skipped)} habe ich nicht angesehen; „Vergleichen“ im Dokument zeigt sie.`)
  }
  lines.push(
    '',
    'Grundlage ist ein Bildvergleich der beiden Fassungen, keine Prüfung gegen Vorschriften oder andere Unterlagen. Übernehmen oder verwerfen Sie die Vorschläge in der Prüfansicht.',
  )
  return lines.join('\n')
}

export function noticeExcerpt(proposals: readonly AnnotationProposal[]): string | null {
  const first = proposals[0]
  return first ? clip(`S. ${first.page}: ${first.body}`, 200) : null
}
