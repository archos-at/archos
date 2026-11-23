import type { MarkTally } from '@/lib/annotations/types'
import type { DocumentAuthor } from '@/lib/db/schema/documents'
import type { RevisionLinks } from '@/lib/documents/revision-links'
import type { PhotoCapture } from '@/lib/documents/photo-capture'
import type { DocumentReference, Dossier, ReadingCoverage } from '@/lib/documents/dossier'
import type { RevisionFacts } from '@/lib/documents/revision-facts'
import type { QuarantineVerdict } from '@/lib/upload-screening/quarantine'
import type {
  DocumentLifecycle,
  DocumentVersionState,
} from '@/lib/documents/lifecycle-types'

export interface FolderItem {
  id: string
  parentId: string | null
  name: string
  path: string
  description?: string | null
  createdAt?: string
  updatedAt?: string
  ownAccess?: { everyoneReads: boolean } | null
  access?: 'read' | 'write'
}

export interface FileMailThread {
  entryCount: number
  lastEntryAt: string | null
}

export interface FileItem {
  id: string
  filename: string
  displayName: string | null
  fileSize: number | null
  contentType: string | null
  status: string | null
  folderId: string | null
  originPath?: string | null
  contentHash?: string | null
  createdAt: string
  errorMessage: string | null
  quarantine?: QuarantineVerdict | null
  summary: string | null
  pageCount: number | null
  chunkCount: number | null
  contentTypes: string[] | null
  tags: string[] | null
  topics: string[] | null
  capture: PhotoCapture | null
  revisionFacts?: RevisionFacts | null
  dossier?: Dossier | null
  docReferences?: DocumentReference[] | null
  coverage?: ReadingCoverage | null
  revision?: RevisionLinks | null
  queueAhead?: number | null
  assignees?: readonly FileAssignee[]
  authoredBy?: DocumentAuthor
  versionState?: DocumentVersionState | null
  versionCount?: number | null
  lifecycle?: DocumentLifecycle | null
  sourceDeletedAt?: string | null
  retryable?: boolean
  marks?: MarkTally | null
  baseKnowledgeEntryId?: string | null
  mailThread?: FileMailThread | null
}

export interface FileAssignee {
  userId: string
  name: string | null
  email: string | null
  profilePictureUrl: string | null
}
