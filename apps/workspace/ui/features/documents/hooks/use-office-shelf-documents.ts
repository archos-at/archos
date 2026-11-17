'use client'

import { useFileUpload, type UploadFilesOptions } from '@/features/documents/hooks/use-file-upload'
import type { TrackedFile } from '@/features/documents/types'

interface UseOfficeShelfDocumentsOptions {
  collectionName?: string
  folderId?: string
  onComplete?: () => void
  onError?: (error: Error) => void
}

interface UseOfficeShelfDocumentsReturn {
  uploadFiles: (files: File[], options?: UploadFilesOptions) => Promise<number>
  cancelUpload: () => void
  cancelFile: (fileId: string) => void
  dismissFiles: (fileIds: string[]) => void
  retryFile: (fileId: string) => Promise<void>
  trackedFiles: TrackedFile[]
  isUploading: boolean
  isPolling: boolean
  error: string | null
  clearError: () => void
}

export function useOfficeShelfDocuments(options: UseOfficeShelfDocumentsOptions = {}): UseOfficeShelfDocumentsReturn {
  const { collectionName, folderId, onComplete, onError } = options
  return useFileUpload({ collectionName, officeShelf: true, folderId, onComplete, onError })
}
