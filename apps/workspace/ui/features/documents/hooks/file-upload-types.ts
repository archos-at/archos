import type { NameMatch } from '@/lib/upload-screening/name-screen'
import type { UploadScreeningPolicy } from '@/lib/upload-screening/policy'
import type { TrackedFile } from '../types'
import type { ValidationContext } from '../validation'

export interface UseFileUploadOptions {
  collectionName?: string
  projectId?: string
  folderId?: string
  officeShelf?: boolean
  conversationProjectId?: string | null
  onComplete?: () => void
  onError?: (error: Error) => void
}

export interface UploadFilesOptions {
  collectionOverride?: string
  folderIdFor?: (file: File) => string | null | undefined
  folderPathFor?: (file: File) => string | null | undefined
  screeningReleased?: (file: File) => boolean
  revisionOf?: (file: File) => string | null | undefined
  excludedByScreening?: ReadonlyArray<readonly NameMatch[]>
  screeningPolicy?: UploadScreeningPolicy
}

export interface UseFileUploadReturn {
  uploadFiles: (files: File[], options?: UploadFilesOptions) => Promise<number>
  cancelUpload: () => void
  cancelFile: (fileId: string) => void
  dismissFiles: (fileIds: string[]) => void
  deleteFile: (fileId: string) => Promise<void>
  retryFile: (fileId: string) => Promise<void>
  trackedFiles: TrackedFile[]
  sessionFiles: TrackedFile[]
  validationContext: ValidationContext
  isUploading: boolean
  isPolling: boolean
  error: string | null
  clearError: () => void
}
