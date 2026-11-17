import type { DocumentScreeningOutcome } from '@/lib/db/schema/documents'
import { IN_FLIGHT_DOCUMENT_STATUSES } from './document-status'

export const SCREENING_PASSED_OUTCOMES = ['clean', 'partial', 'unchecked', 'released'] as const satisfies
  readonly DocumentScreeningOutcome[]

export const UNSCREENED_SETTLED_STATUSES = ['completed'] as const

export interface ScreeningFacts {
  status: string
  authoredBy: string
  screeningOutcome: DocumentScreeningOutcome | null
  contentHash: string | null
  screenedHash: string | null
}

const PASSED: ReadonlySet<string> = new Set(SCREENING_PASSED_OUTCOMES)
const SETTLED: ReadonlySet<string> = new Set(UNSCREENED_SETTLED_STATUSES)

export function hasPassedScreening(row: ScreeningFacts): boolean {
  if (row.status === 'quarantined') return false
  if (row.authoredBy !== 'user') return true
  if ((row.screenedHash ?? null) !== (row.contentHash ?? null)) return false
  return verdictPasses(row)
}

export function verdictPasses(row: Pick<ScreeningFacts, 'status' | 'screeningOutcome'>): boolean {
  if (row.status === 'quarantined') return false
  const verdict = row.screeningOutcome ?? null
  if (verdict !== null) return PASSED.has(verdict)
  return SETTLED.has(row.status)
}

const ITEM_BYTES_STATES: ReadonlySet<string> = new Set(['published', 'superseded'])

export interface VersionScreeningFacts {
  state: string
  contentHash: string | null
  screenedHash: string | null
}

export function versionBytesPassedScreening(document: ScreeningFacts, version: VersionScreeningFacts): boolean {
  if (!hasPassedScreening(document)) return false
  if (document.authoredBy !== 'user' || !ITEM_BYTES_STATES.has(version.state)) return true
  const held = version.contentHash ?? null
  const ownVerdict = held !== null && held === (version.screenedHash ?? null)
  return ownVerdict || held === (document.screenedHash ?? null)
}

export function isHeldAtRest(row: ScreeningFacts): boolean {
  return !hasPassedScreening(row) && !IN_FLIGHT_DOCUMENT_STATUSES.has(row.status)
}

export type ShelfReader = { readonly kind: 'member'; readonly userId: string } | { readonly kind: 'reviewer' }

export type InternalDocumentRead =
  | 'just-written'
  | 'ingest'
  | 'quarantine-review'
  | 'identity'
  | 'audit'
  | 'reloaded'
  | 'resolve-document'

export type DocumentReader =
  | ShelfReader
  | { readonly kind: 'shelves'; readonly project: ShelfReader; readonly officeShelf: ShelfReader }
  | {
      readonly kind: 'projects'
      readonly userId: string
      readonly reviewedProjectIds: readonly string[]
      readonly reviewsOfficeShelf?: boolean
    }
  | { readonly kind: 'screened-only' }
  | { readonly kind: 'internal'; readonly why: InternalDocumentRead }

export const memberReader = (userId: string): ShelfReader => ({ kind: 'member', userId })
export const REVIEWER_READER: ShelfReader = { kind: 'reviewer' }
export const SCREENED_ONLY = { kind: 'screened-only' } as const satisfies DocumentReader
export const internalRead = (why: InternalDocumentRead): DocumentReader => ({ kind: 'internal', why })

export interface ReadableFacts extends ScreeningFacts {
  createdBy: string
  scope: string
  projectId: string | null
}

function shelfMayRead(row: ReadableFacts, reader: ShelfReader): boolean {
  return reader.kind === 'reviewer' || row.createdBy === reader.userId
}

export function mayReadDocument(row: ReadableFacts, reader: DocumentReader): boolean {
  if (reader.kind === 'internal' || reader.kind === 'reviewer') return true
  if (hasPassedScreening(row)) return true
  switch (reader.kind) {
    case 'member':
      return shelfMayRead(row, reader)
    case 'shelves':
      if (row.scope === 'project') return shelfMayRead(row, reader.project)
      if (row.scope === 'office_shelf') return shelfMayRead(row, reader.officeShelf)
      return false
    case 'projects':
      return (
        row.createdBy === reader.userId ||
        (row.scope === 'project' && row.projectId !== null && reader.reviewedProjectIds.includes(row.projectId)) ||
        (row.scope === 'office_shelf' && reader.reviewsOfficeShelf === true)
      )
    case 'screened-only':
      return false
  }
}

export type ListingReader = ShelfReader | typeof SCREENED_ONLY

export function keepReadable<T extends ScreeningFacts & { createdBy: string }>(rows: T[], reader: ListingReader): T[] {
  return rows.filter(
    (row) =>
      reader.kind === 'reviewer' ||
      hasPassedScreening(row) ||
      (reader.kind === 'member' && row.createdBy === reader.userId)
  )
}
