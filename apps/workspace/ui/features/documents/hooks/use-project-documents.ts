'use client'

import { useCallback } from 'react'
import { useFileUpload, type UploadFilesOptions } from '@/features/documents/hooks/use-file-upload'
import { useDocumentsStore } from '@/features/documents/store'
import { storedSince, type StoredUpload } from './use-office-shelf-documents'

interface UseProjectDocumentsOptions {
  projectId?: string
  collectionName?: string
  folderId?: string
  onComplete?: () => void
  onError?: (error: Error) => void
  onStored?: (uploads: StoredUpload[]) => void
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
  const { projectId, collectionName, folderId, onComplete, onError, onStored } = options

  const upload = useFileUpload({ collectionName, projectId, folderId, onComplete, onError })
  const { uploadFiles: uploadTracked } = upload
  const uploadFiles = useCallback(
    async (files: File[], uploadOptions?: UploadFilesOptions): Promise<number> => {
      const before = new Set(useDocumentsStore.getState().trackedFiles.map((file) => file.id))
      const taken = await uploadTracked(files, uploadOptions)
      const stored = storedSince(before, useDocumentsStore.getState().trackedFiles)
      if (stored.length > 0) onStored?.(stored)
      return taken
    },
    [uploadTracked, onStored]
  )

  return {
    ...upload,
    uploadFiles,
    collectionName,
  }
}
