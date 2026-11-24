import type { StoredEntry } from '@/lib/base-knowledge/store/repository'
import { proposeFromReading, recognizeNorm } from '@/lib/base-knowledge/office/reading'
import { workDesignation } from '@/lib/base-knowledge/office/work-designation'
import { hasPassedScreening, type ScreeningFacts } from '@/lib/documents/document-reader'
import { surfaceStateOf } from '@/lib/documents/surface-state'
import type { NormOffer } from './wire'

export interface HeldEdition {
  entry: Pick<StoredEntry, 'editionId' | 'documentId' | 'values' | 'createdAt'>
  contentHash: string | null
}

export type HeldWorks = ReadonlyMap<string, readonly HeldEdition[]>

export function workKey(designation: string | null | undefined): string | null {
  const work = workDesignation(designation ?? null)?.replace(/\s+/g, ' ').trim()
  return work ? work.toUpperCase() : null
}

const UNKNOWN_EDITION = 'unbekannt'

const known = (label: string | null | undefined): label is string => Boolean(label && label.trim() && label.trim().toLowerCase() !== UNKNOWN_EDITION)

function sameEdition(a: string | null | undefined, b: string | null | undefined): boolean {
  return known(a) && known(b) && a.trim().toLowerCase() === b.trim().toLowerCase()
}

export interface ProjectNorm {
  designation: string | null
  editionLabel: string | null
  contentHash: string | null
}

export type ShelfPlacement =
  | { kind: 'new' }
  | { kind: 'edition'; of: HeldEdition }
  | { kind: 'duplicate'; of: HeldEdition }

const heldEditionsOf = (norm: ProjectNorm, works: HeldWorks): readonly HeldEdition[] => {
  const key = workKey(norm.designation)
  return key ? (works.get(key) ?? []) : []
}

const holds = (held: HeldEdition, norm: ProjectNorm): boolean =>
  (norm.contentHash !== null && held.contentHash === norm.contentHash) || sameEdition(held.entry.values.editionLabel, norm.editionLabel)

export function placementFor(norm: ProjectNorm, works: HeldWorks): ShelfPlacement {
  const editions = heldEditionsOf(norm, works)
  if (editions.length === 0) return { kind: 'new' }
  const duplicate = editions.find((held) => holds(held, norm))
  if (duplicate) return { kind: 'duplicate', of: duplicate }
  const newest = [...editions].sort((a, b) => b.entry.createdAt.getTime() - a.entry.createdAt.getTime())[0]
  return { kind: 'edition', of: newest }
}

export interface NormCandidateRow extends ScreeningFacts {
  id: string
  filename: string
  displayName: string | null
  folderId: string | null
}

const SETTLED_STATES = new Set(['citable', 'stored'])

export function isSettled(row: ScreeningFacts & { status: string }): boolean {
  return hasPassedScreening(row) && SETTLED_STATES.has(surfaceStateOf(row.status))
}

export interface OfferFilters {
  kept: ReadonlySet<string>
  suggested: ReadonlySet<string>
  works: HeldWorks
}

export interface RecognizedNorm extends NormOffer, ProjectNorm {
  issuedOn: string | null
}

export function recognizedNorms(rows: readonly NormCandidateRow[]): RecognizedNorm[] {
  return rows.flatMap((row) => {
    if (!isSettled(row)) return []
    const fileName = row.displayName ?? row.filename
    const recognized = recognizeNorm({ fileName })
    if (!recognized.norm) return []
    const read = proposeFromReading({ fileName }, {})
    const editionLabel = read.editionLabel === UNKNOWN_EDITION ? null : read.editionLabel
    return [
      {
        documentId: row.id,
        fileName,
        folderId: row.folderId,
        designation: recognized.designation,
        kind: read.kind,
        editionLabel,
        issuedOn: editionLabel ? read.issuedOn : null,
        contentHash: row.contentHash,
      },
    ]
  })
}

export function undecided<T extends NormOffer>(norms: readonly T[], { kept, suggested }: Pick<OfferFilters, 'kept' | 'suggested'>): T[] {
  return norms.filter((norm) => !kept.has(norm.documentId) && !suggested.has(norm.documentId))
}

const DATED = /^(?:19|20)\d{2}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/

function dayOf(editionLabel: string | null, issuedOn: string | null): string | null {
  if (issuedOn) return issuedOn
  const label = editionLabel?.trim() ?? ''
  return DATED.test(label) ? label : null
}

function laterThan(day: string, other: string): boolean {
  const length = Math.min(day.length, other.length)
  return day.slice(0, length) > other.slice(0, length)
}

export function isNewToOffice(norm: RecognizedNorm, works: HeldWorks): boolean {
  const editions = heldEditionsOf(norm, works)
  if (editions.length === 0) return true
  if (!known(norm.editionLabel) || editions.some((held) => holds(held, norm))) return false
  const day = dayOf(norm.editionLabel, norm.issuedOn)
  if (!day) return true
  return editions.every((held) => {
    const other = dayOf(held.entry.values.editionLabel, held.entry.values.issuedOn)
    return !other || laterThan(day, other)
  })
}

export function offerable<T extends RecognizedNorm>(norms: readonly T[], filters: OfferFilters): T[] {
  return undecided(norms, filters).filter((norm) => isNewToOffice(norm, filters.works))
}

export function offerOf({ documentId, fileName, folderId, designation, kind, editionLabel }: RecognizedNorm): NormOffer {
  return { documentId, fileName, folderId, designation, kind, editionLabel }
}
