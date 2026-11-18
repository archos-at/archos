import { parsePhotoCapture, type PhotoCapture } from '../photo-capture'
import { parseRevisionFacts, type RevisionFacts } from '../revision-facts'
import {
  parseDocumentReferences,
  parseDossier,
  parseReadingCoverage,
  type DocumentReference,
  type Dossier,
  type ReadingCoverage,
} from '../dossier'
import type { CollectionFileRef } from '../collection-file-ref'
import type { CollectionFiles } from './collection-listing-types'

export interface DocumentMetadata {
  summary?: string
  pageCount?: number
  chunkCount?: number
  contentTypes?: string[]
  tags?: string[]
  topics?: string[]
  capture?: PhotoCapture
  revisionFacts?: RevisionFacts
  dossier?: Dossier
  docReferences?: DocumentReference[]
  coverage?: ReadingCoverage
  queueAhead?: number | null
}

export const extractMetadata = (files: CollectionFiles | null, ref: CollectionFileRef): DocumentMetadata | null => {
  if (!files || files.ambiguousNames.has(ref.filename)) return null
  const file = files.byName.get(ref.filename)
  if (!file) return null

  const meta: DocumentMetadata = {}
  if (typeof file.summary === 'string' && file.summary.length > 0) meta.summary = file.summary
  if (typeof file.page_count === 'number' && file.page_count > 0) meta.pageCount = file.page_count
  if (typeof file.chunk_count === 'number' && file.chunk_count > 0) meta.chunkCount = file.chunk_count
  if (Array.isArray(file.content_types) && file.content_types.length > 0) {
    meta.contentTypes = file.content_types
  }
  if (Array.isArray(file.tags) && file.tags.length > 0) {
    meta.tags = file.tags.filter((t): t is string => typeof t === 'string')
  }
  if (Array.isArray(file.topics)) {
    const topics = file.topics.filter((t): t is string => typeof t === 'string' && t.length > 0)
    if (topics.length > 0) meta.topics = topics
  }
  const capture = parsePhotoCapture(file.capture)
  if (capture) meta.capture = capture
  const revisionFacts = parseRevisionFacts(file.revision_facts)
  if (revisionFacts) meta.revisionFacts = revisionFacts
  const dossier = parseDossier(file.dossier)
  if (dossier) meta.dossier = dossier
  const docReferences = parseDocumentReferences(file.doc_references)
  if (docReferences) meta.docReferences = docReferences
  const coverage = parseReadingCoverage(file.coverage)
  if (coverage) meta.coverage = coverage
  return Object.keys(meta).length > 0 ? meta : null
}

export interface ListedReading {
  metadata: DocumentMetadata | null
  superseded: boolean
}

export function readingsIn(
  files: CollectionFiles,
  collectionName: string,
  refs: readonly CollectionFileRef[]
): Map<string, ListedReading> {
  const readings = new Map<string, ListedReading>()
  for (const ref of refs) {
    if (ref.collectionName !== collectionName || files.ambiguousNames.has(ref.filename)) continue
    const file = files.byName.get(ref.filename)
    if (!file) continue
    readings.set(ref.filename, { metadata: extractMetadata(files, ref), superseded: Boolean(file.revision?.supersededBy) })
  }
  return readings
}
