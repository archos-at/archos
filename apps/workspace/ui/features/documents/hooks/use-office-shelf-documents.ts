'use client'

import { useCallback } from 'react'
import { useFileUpload, type UploadFilesOptions } from '@/features/documents/hooks/use-file-upload'
import { useDocumentsStore } from '@/features/documents/store'
import type { TrackedFile, TrackedFileStatus } from '@/features/documents/types'

export interface StoredUpload {
  documentId: string
  fileName: string
}

interface UseOfficeShelfDocumentsOptions {
  collectionName?: string
  folderId?: string
  forStandards?: boolean
  onComplete?: () => void
  onError?: (error: Error) => void
  onStored?: (uploads: StoredUpload[]) => void
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

const NOT_STORED: ReadonlySet<TrackedFileStatus> = new Set<TrackedFileStatus>(['uploading', 'failed', 'canceled', 'held', 'deleting'])

export function storedSince(before: ReadonlySet<string>, tracked: readonly TrackedFile[]): StoredUpload[] {
  return tracked.flatMap((file) =>
    !before.has(file.id) && file.serverFileId && !NOT_STORED.has(file.status)
      ? [{ documentId: file.serverFileId, fileName: file.fileName }]
      : [],
  )
}

export function useOfficeShelfDocuments(options: UseOfficeShelfDocumentsOptions = {}): UseOfficeShelfDocumentsReturn {
  const { collectionName, folderId, forStandards, onComplete, onError, onStored } = options
  const upload = useFileUpload({ collectionName, officeShelf: true, forStandards, folderId, onComplete, onError })
  const { uploadFiles: uploadTracked } = upload
  const uploadFiles = useCallback(
    async (files: File[], uploadOptions?: UploadFilesOptions): Promise<number> => {
      const before = new Set(useDocumentsStore.getState().trackedFiles.map((file) => file.id))
      const taken = await uploadTracked(files, uploadOptions)
      const stored = storedSince(before, useDocumentsStore.getState().trackedFiles)
      if (stored.length > 0) onStored?.(stored)
      return taken
    },
    [uploadTracked, onStored],
  )
  return { ...upload, uploadFiles }
}
