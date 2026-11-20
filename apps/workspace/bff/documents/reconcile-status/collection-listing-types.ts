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
  byName: Map<string, BackendFileEntry>
  ambiguousNames: Set<string>
  readingUnavailable: boolean
}

export interface RawBackendFile extends RawRevisionLinkFields {
  file_name?: string
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
