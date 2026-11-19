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

function sameEdition(a: string | null | undefined, b: string | null | undefined): boolean {
  const known = (label: string | null | undefined) => Boolean(label && label.trim() && label.trim().toLowerCase() !== UNKNOWN_EDITION)
  return known(a) && known(b) && a!.trim().toLowerCase() === b!.trim().toLowerCase()
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

export function placementFor(norm: ProjectNorm, works: HeldWorks): ShelfPlacement {
  const key = workKey(norm.designation)
  const editions = key ? (works.get(key) ?? []) : []
  if (editions.length === 0) return { kind: 'new' }
  const duplicate = editions.find(
    (held) =>
      (norm.contentHash !== null && held.contentHash === norm.contentHash) ||
      sameEdition(held.entry.values.editionLabel, norm.editionLabel)
  )
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

export function recognizedNorms(rows: readonly NormCandidateRow[]): NormOffer[] {
  return rows.flatMap((row) => {
    if (!isSettled(row)) return []
    const fileName = row.displayName ?? row.filename
    const recognized = recognizeNorm({ fileName })
    if (!recognized.norm) return []
    const read = proposeFromReading({ fileName }, {})
    const editionLabel = read.editionLabel === UNKNOWN_EDITION ? null : read.editionLabel
    return [{ documentId: row.id, fileName, folderId: row.folderId, designation: recognized.designation, kind: read.kind, editionLabel }]
  })
}

export function offerable(norms: readonly NormOffer[], { kept, suggested, works }: OfferFilters): NormOffer[] {
  return norms.filter((norm) => {
    if (kept.has(norm.documentId) || suggested.has(norm.documentId)) return false
    const key = workKey(norm.designation)
    return !(key && works.has(key))
  })
}
