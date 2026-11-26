import type { CollectionFileRef } from '../collection-file-ref'
import type { RawRevisionLinkFields, RevisionLinkNames } from '../revision-links'

export interface BackendFileEntry {
  status?: string
  error_message?: string | null
  quarantine?: unknown
  summary?: string | null
  chunk_count?: number
  page_count?: number
  content_types?: string[]
  tags?: string[] | null
  topics?: string[] | null
  capture?: unknown
  revision_facts?: unknown
  dossier?: unknown
  doc_references?: unknown
  coverage?: unknown
  revision?: RevisionLinkNames | null
}

export interface CollectionFiles {
  byId: Map<string, BackendFileEntry>
  byName: Map<string, BackendFileEntry>
  ambiguousNames: Set<string>
  readingUnavailable: boolean
}

export type ListedFile = { state: 'listed'; file: BackendFileEntry } | { state: 'ambiguous' } | { state: 'absent' }

export function listedFileOf(files: CollectionFiles, ref: CollectionFileRef): ListedFile {
  const byId = ref.documentId ? files.byId.get(ref.documentId) : undefined
  if (byId) return { state: 'listed', file: byId }
  if (files.ambiguousNames.has(ref.filename)) return { state: 'ambiguous' }
  const byName = files.byName.get(ref.filename)
  return byName ? { state: 'listed', file: byName } : { state: 'absent' }
}

export function fileListedFor(files: CollectionFiles | null, ref: CollectionFileRef): BackendFileEntry | undefined {
  if (!files) return undefined
  const listed = listedFileOf(files, ref)
  return listed.state === 'listed' ? listed.file : undefined
}

export interface RawBackendFile extends RawRevisionLinkFields {
  file_name?: string
  document_id?: string | null
  superseded_by_id?: string | null
  status?: string
  error_message?: string | null
  quarantine?: unknown
  summary?: string | null
  chunk_count?: number
  tags?: string[] | null
  topics?: string[] | null
  capture?: unknown
  revision_facts?: unknown
  dossier?: unknown
  doc_references?: unknown
  coverage?: unknown
  metadata?: { page_count?: number; content_types?: string[] } | null
}
