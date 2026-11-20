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
import { storedSince, useOfficeShelfDocuments } from './use-office-shelf-documents'

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

describe('the office shelf upload', () => {
  it('names the documents this upload stored, and not a file that failed, was held or came earlier', () => {
    const before = new Set(['earlier'])
    expect(
      storedSince(before, [
        tracked('earlier', 'success', 'doc-earlier'),
        tracked('norm', 'ingesting', 'doc-norm'),
        tracked('kept', 'stored', 'doc-kept'),
        tracked('held', 'held', 'doc-held'),
        tracked('failed', 'failed', 'doc-failed'),
        tracked('lost', 'uploading'),
      ]),
    ).toEqual([
      { documentId: 'doc-norm', fileName: 'norm.pdf' },
      { documentId: 'doc-kept', fileName: 'kept.pdf' },
    ])
  })

  it('hands the stored documents on once the upload returns', async () => {
    upload.arriving = [tracked('norm', 'ingesting', 'doc-norm'), tracked('held', 'held', 'doc-held')]
    const onStored = vi.fn()
    const { result } = renderHook(() => useOfficeShelfDocuments({ collectionName: 'archiv_org-1', onStored }))
    await act(async () => {
      expect(await result.current.uploadFiles([new File(['a'], 'norm.pdf')])).toBe(1)
    })
    expect(onStored).toHaveBeenCalledWith([{ documentId: 'doc-norm', fileName: 'norm.pdf' }])
  })

  it('says nothing when the upload stored nothing', async () => {
    upload.arriving = [tracked('failed', 'failed')]
    const onStored = vi.fn()
    const { result } = renderHook(() => useOfficeShelfDocuments({ collectionName: 'archiv_org-1', onStored }))
    await act(async () => {
      await result.current.uploadFiles([new File(['a'], 'failed.pdf')])
    })
    expect(onStored).not.toHaveBeenCalled()
  })
})
