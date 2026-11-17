'use client'

import { useFileUpload, type UploadFilesOptions } from '@/features/documents/hooks/use-file-upload'

interface UseProjectDocumentsOptions {
  projectId?: string
  collectionName?: string
  folderId?: string
  onComplete?: () => void
  onError?: (error: Error) => void
}

interface UseProjectDocumentsReturn {
  uploadFiles: (files: File[], options?: UploadFilesOptions) => Promise<number>
  cancelUpload: () => void
  cancelFile: (fileId: string) => void
  dismissFiles: (fileIds: string[]) => void
  retryFile: (fileId: string) => Promise<void>
  trackedFiles: import('@/features/documents/types').TrackedFile[]
  isUploading: boolean
  isPolling: boolean
  error: string | null
  clearError: () => void
  collectionName?: string
}

export function useProjectDocuments(options: UseProjectDocumentsOptions = {}): UseProjectDocumentsReturn {
  const { projectId, collectionName, folderId, onComplete, onError } = options

  const upload = useFileUpload({ collectionName, projectId, folderId, onComplete, onError })

  return {
    ...upload,
    collectionName,
  }
}
