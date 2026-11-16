import type {
  DocumentFileStatus,
  CollectionInfo,
  FileInfo,
  IngestionJobStatus,
} from '@/adapters/api/documents-schemas'
import type { FileItem } from './components/project-file-workspace'
import type { QuarantineVerdict } from '@/lib/upload-screening/quarantine'

export type {
  DocumentFileStatus,
  JobState,
  CollectionInfo,
  FileInfo,
  FileProgress,
  IngestionJobStatus,
} from '@/adapters/api/documents-schemas'

export interface CreateCollectionRequest {
  name: string
  description?: string
  metadata?: Record<string, unknown>
}

export interface UploadIntent {
  folderId: string | null
  folderPath: string | null
  screeningReleased: boolean
  revisionOf?: string | null
}

export type TrackedFileStatus = DocumentFileStatus | 'deleting' | 'canceled' | 'held' | 'stored'

export interface TrackedFile {
  id: string
  file?: File
  uploadIntent?: UploadIntent
  fileName: string
  fileSize: number
  status: TrackedFileStatus
  progress: number
  bytesUploaded?: number
  uploadStartedAt?: number
  errorMessage?: string | null
  quarantine?: QuarantineVerdict | null
  retryable?: false
  replacesHeld?: { documentId: string | null; ownUpload: boolean }
  serverFileId?: string
  jobId?: string
  unchanged?: boolean
  collectionName?: string
  uploadedAt?: string | null
}

export function mayRetryUpload(file: Pick<TrackedFile, 'status' | 'retryable'>): boolean {
  return file.status !== 'held' && file.retryable !== false
}

export interface JobBannerState {
  uploaded: boolean
  ingested: boolean
}

export type BannerType = keyof JobBannerState

export const DEFAULT_JOB_BANNER_STATE: JobBannerState = {
  uploaded: false,
  ingested: false,
}

export function trackedFileToFileItem(file: TrackedFile): FileItem {
  return {
    id: file.serverFileId ?? file.id,
    filename: file.fileName,
    displayName: null,
    fileSize: file.fileSize ?? null,
    contentType: null,
    status: file.status === 'held' ? 'quarantined' : file.status,
    folderId: null,
    createdAt: file.uploadedAt ?? new Date().toISOString(),
    errorMessage: file.errorMessage ?? null,
    quarantine: file.quarantine ?? null,
    summary: null,
    pageCount: null,
    chunkCount: null,
    contentTypes: null,
    tags: null,
    topics: null,
    capture: null,
  }
}

export interface DocumentsState {
  currentCollectionName: string | null
  collectionInfo: CollectionInfo | null
  trackedFiles: TrackedFile[]
  activeJobId: string | null
  isCreatingCollection: boolean
  isUploading: boolean
  isPolling: boolean
  isLoadingFiles: boolean
  loadedSessionId: string | null
  recentlyDeletedIds: Set<string>
  error: string | null
  nameStopped: { count: number; uploadAnyway: () => void } | null
  shownBannersForJobs: Record<string, JobBannerState>
}

export interface DocumentsActions {
  setCurrentCollection: (name: string | null) => void
  setCollectionInfo: (info: CollectionInfo | null) => void

  addTrackedFile: (file: TrackedFile) => void
  updateTrackedFile: (id: string, updates: Partial<TrackedFile>) => void
  setUploadProgress: (id: string, bytesUploaded: number) => void
  removeTrackedFile: (id: string) => void
  dismissTrackedFiles: (ids: string[]) => void
  unmarkRecentlyDeleted: (file: TrackedFile) => void
  removeRecentlyDeletedIds: (ids: string[]) => void
  clearTrackedFiles: () => void
  clearFilesForCollection: (collectionName: string) => void

  setActiveJobId: (jobId: string | null) => void

  setCreatingCollection: (loading: boolean) => void
  setUploading: (loading: boolean) => void
  setPolling: (polling: boolean) => void
  setLoadingFiles: (loading: boolean) => void

  setError: (error: string | null) => void
  clearError: () => void
  setNameStopped: (stopped: DocumentsState['nameStopped']) => void

  updateFilesFromJobStatus: (jobStatus: IngestionJobStatus) => void
  setFilesFromServer: (collectionName: string, files: FileInfo[]) => void

  markBannerShown: (jobId: string, type: BannerType) => void
}

export type DocumentsStore = DocumentsState & DocumentsActions
