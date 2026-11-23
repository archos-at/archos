import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackedFile } from '../types'

const upload = vi.hoisted(() => ({ arriving: [] as TrackedFile[] }))

vi.mock('@/features/documents/hooks/use-file-upload', async () => {
  const { useDocumentsStore } = await import('@/features/documents/store')
  return {
    useFileUpload: () => ({
      uploadFiles: async (files: File[]) => {
        for (const file of upload.arriving) useDocumentsStore.getState().addTrackedFile(file)
        return files.length
      },
      isUploading: false,
      error: null,
    }),
  }
})

import { useDocumentsStore } from '../store'
import { useProjectDocuments } from './use-project-documents'

const tracked = (id: string, status: TrackedFile['status'], serverFileId?: string): TrackedFile => ({
  id,
  fileName: `${id}.pdf`,
  fileSize: 1,
  status,
  progress: 100,
  ...(serverFileId ? { serverFileId } : {}),
})

beforeEach(() => {
  useDocumentsStore.setState({ trackedFiles: [tracked('earlier', 'success', 'doc-earlier')] })
})

describe('the project upload', () => {
  it('hands on the documents this upload stored, for the norm dialog', async () => {
    upload.arriving = [tracked('norm', 'ingesting', 'doc-norm'), tracked('failed', 'failed')]
    const onStored = vi.fn()
    const { result } = renderHook(() => useProjectDocuments({ projectId: 'project-1', collectionName: 'p1', onStored }))
    await act(async () => {
      expect(await result.current.uploadFiles([new File(['a'], 'norm.pdf')])).toBe(1)
    })
    expect(onStored).toHaveBeenCalledWith([{ documentId: 'doc-norm', fileName: 'norm.pdf' }])
  })
})
