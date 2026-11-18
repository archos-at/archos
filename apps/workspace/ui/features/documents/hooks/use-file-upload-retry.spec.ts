import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { filesCopy } from '@/i18n/namespaces/files'

vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))

const { mockClient, mockDocumentsStoreState, mockOrchestratorFns } = vi.hoisted(() => {
  const state = {
    trackedFiles: [] as unknown[],
    isUploading: false,
    isPolling: false,
    error: null as string | null,
    setCurrentCollection: vi.fn(),
    setCollectionInfo: vi.fn(),
    addTrackedFile: vi.fn(),
    updateTrackedFile: vi.fn(),
    removeTrackedFile: vi.fn(),
    unmarkRecentlyDeleted: vi.fn(),
    removeRecentlyDeletedIds: vi.fn(),
    setUploadProgress: vi.fn(),
    dismissTrackedFiles: vi.fn(),
    setUploading: vi.fn(),
    setError: vi.fn(),
    clearError: vi.fn(),
    setNameStopped: vi.fn(),
  }

  state.addTrackedFile.mockImplementation((file: unknown) => {
    state.trackedFiles = [...state.trackedFiles, file]
  })
  state.updateTrackedFile.mockImplementation((id: unknown, updates: unknown) => {
    state.trackedFiles = state.trackedFiles.map((f) =>
      (f as { id?: unknown }).id === id ? { ...(f as object), ...(updates as object) } : f
    )
  })
  state.setUploadProgress.mockImplementation((id: unknown, bytesUploaded: number) => {
    state.trackedFiles = state.trackedFiles.map((f) =>
      (f as { id?: unknown }).id === id ? { ...(f as object), bytesUploaded } : f
    )
  })

  return {
    mockClient: {
      getCollection: vi.fn(),
      createCollection: vi.fn(),
      deleteFiles: vi.fn(),
      listFiles: vi.fn(),
    },
    mockDocumentsStoreState: state,
    mockOrchestratorFns: {
      setAuthToken: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      handleSessionChange: vi.fn(),
      loadFilesForSession: vi.fn(),
      enqueueJobs: vi.fn(),
      watchDocuments: vi.fn(),
      pollSessionDocuments: vi.fn(),
      stopPolling: vi.fn(),
    },
  }
})

vi.mock('@/adapters/api', () => ({
  createDocumentsClient: () => mockClient,
}))

vi.mock('@/adapters/auth', () => ({
  useAuth: () => ({ idToken: 'test-token' }),
}))

vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({
    authRequired: true,
    fileUpload: {
      acceptedTypes: '.pdf,.docx,.txt,.md',
      acceptedMimeTypes: ['application/pdf', 'text/plain', 'text/markdown'],
      maxTotalSizeMB: 100,
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 100 * 1024 * 1024,
      maxFileCount: 10,
    },
  }),
}))

vi.mock('../store', () => {
  const useDocumentsStore = (selector?: (state: typeof mockDocumentsStoreState) => unknown) =>
    selector ? selector(mockDocumentsStoreState) : mockDocumentsStoreState
  useDocumentsStore.getState = () => mockDocumentsStoreState
  return { useDocumentsStore }
})

vi.mock('@/features/chat/store', () => {
  const mockChatState = { addFileUploadStatusCard: vi.fn() }
  const useChatStore = (selector: (state: typeof mockChatState) => unknown) =>
    selector(mockChatState)
  useChatStore.getState = () => mockChatState
  return { useChatStore }
})

const mockRequestReingest = vi.fn()
vi.mock('../lib/reingest-request', () => ({
  requestReingest: (documentId: string) => mockRequestReingest(documentId),
}))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }))

vi.mock('../orchestrator', () => ({
  UploadOrchestrator: mockOrchestratorFns,
}))

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: (selector: (state: { knowledgeLayerAvailable: boolean }) => unknown) =>
    selector({ knowledgeLayerAvailable: true }),
}))

const mockMarkSessionHasCollection = vi.fn()
vi.mock('../persistence', () => ({
  markSessionHasCollection: (...args: unknown[]) => mockMarkSessionHasCollection(...args),
}))

vi.mock('@/adapters/api/upload-screening-policy', async (importOriginal) => {
  const { SUGGESTED_SCREENING_POLICY } = await import('@/lib/upload-screening/policy')
  return {
    ...(await importOriginal<typeof import('@/adapters/api/upload-screening-policy')>()),
    loadUploadScreeningPolicy: vi.fn().mockResolvedValue(SUGGESTED_SCREENING_POLICY),
  }
})

vi.mock('../validation', () => ({
  validateFileUpload: vi.fn((files: File[]) => ({
    validFiles: files,
    batchErrors: [],
    fileErrors: [],
    summary: '',
  })),
}))

const uuidState = vi.hoisted(() => ({ count: 0 }))
vi.mock('uuid', () => ({
  v4: () => {
    const index = uuidState.count++
    return index === 0 ? 'mock-uuid' : `mock-uuid-${index}`
  },
}))

import { useFileUpload } from './use-file-upload'
import { installFakeXhr } from '@/test-utils/xhr-mock'

describe('useFileUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uuidState.count = 0
    mockDocumentsStoreState.trackedFiles = []
    mockDocumentsStoreState.isUploading = false
    mockDocumentsStoreState.isPolling = false
    mockDocumentsStoreState.error = null
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('retryFile on a file the server could not read', () => {
    const readFailure = {
      id: 'file-1',
      fileName: 'plan.pdf',
      collectionName: 'proj-1',
      fileSize: 1000,
      status: 'failed',
      serverFileId: 'doc-1',
      errorMessage: 'empty_document: nothing to read',
      file: new File(['x'], 'plan.pdf'),
    }

    test('reads it again instead of sending the bytes again', async () => {
      mockDocumentsStoreState.trackedFiles = [readFailure] as unknown[]
      mockRequestReingest.mockResolvedValueOnce({ kind: 'started', status: 'pending' })
      const { result } = renderHook(() => useFileUpload({ collectionName: 'proj-1', projectId: 'p1' }))

      await act(async () => {
        await result.current.retryFile('file-1')
      })

      expect(mockRequestReingest).toHaveBeenCalledWith('doc-1')
      expect(mockDocumentsStoreState.removeTrackedFile).not.toHaveBeenCalled()
      expect(mockDocumentsStoreState.updateTrackedFile).toHaveBeenCalledWith(
        'file-1',
        expect.objectContaining({ status: 'ingesting', errorMessage: null })
      )
      expect(mockOrchestratorFns.watchDocuments).toHaveBeenCalledWith(['file-1'])
    })

    test('takes the retry away when the server says the same bytes would fail again', async () => {
      mockDocumentsStoreState.trackedFiles = [readFailure] as unknown[]
      mockRequestReingest.mockResolvedValueOnce({ kind: 'unchanged' })
      const { result } = renderHook(() => useFileUpload({ collectionName: 'proj-1', projectId: 'p1' }))

      await act(async () => {
        await result.current.retryFile('file-1')
      })

      expect(mockDocumentsStoreState.updateTrackedFile).toHaveBeenCalledWith('file-1', { retryable: false })
      expect(mockDocumentsStoreState.removeTrackedFile).not.toHaveBeenCalled()
    })
  })

  describe('retryFile', () => {
    test('does nothing when file not found', async () => {
      mockDocumentsStoreState.trackedFiles = []

      const { result } = renderHook(() => useFileUpload({ collectionName: 'session-1' }))

      await act(async () => {
        await result.current.retryFile('file-1')
      })

      expect(mockDocumentsStoreState.removeTrackedFile).not.toHaveBeenCalled()
    })

    test('sets error when file has no File object', async () => {
      mockDocumentsStoreState.trackedFiles = [
        { id: 'file-1', fileName: 'test.pdf', collectionName: 'session-1', fileSize: 1000 },
      ] as unknown[]

      const { result } = renderHook(() => useFileUpload({ collectionName: 'session-1' }))

      await act(async () => {
        await result.current.retryFile('file-1')
      })

      expect(mockDocumentsStoreState.setError).toHaveBeenCalledWith(
        filesCopy.messages.en.errors.cannotRetryServerFile
      )
    })

    test('removes and re-uploads file', async () => {
      const testFile = new File(['test'], 'test.pdf', { type: 'application/pdf' })
      mockDocumentsStoreState.trackedFiles = [
        {
          id: 'file-1',
          fileName: 'test.pdf',
          collectionName: 'session-1',
          fileSize: 1000,
          file: testFile,
        },
      ] as unknown[]

      const xhr = installFakeXhr()
      const { result } = renderHook(() => useFileUpload({ collectionName: 'session-1' }))

      let pending!: Promise<unknown>
      await act(async () => {
        pending = result.current.retryFile('file-1')
        await Promise.resolve()
      })
      await act(async () => {
        xhr.last().respond(200, JSON.stringify({ documentId: 'doc-1', jobId: null, status: 'pending' }))
        await pending
      })
      xhr.restore()

      expect(mockDocumentsStoreState.removeTrackedFile).toHaveBeenCalledWith('file-1')
      expect(xhr.last().url).toBe('/api/session/documents/upload')
    })

    test('same-tick retries on the session shelf go one file at a time, and none is dropped', async () => {
      const files = ['a.pdf', 'b.pdf'].map((name) => new File(['x'], name, { type: 'application/pdf' }))
      mockDocumentsStoreState.trackedFiles = files.map((file, index) => ({
        id: `file-${index}`,
        fileName: file.name,
        collectionName: 'session-1',
        fileSize: 1,
        file,
      })) as unknown[]

      const xhr = installFakeXhr()
      const { result } = renderHook(() => useFileUpload({ collectionName: 'session-1' }))

      let pending!: Promise<void[]>
      await act(async () => {
        pending = Promise.all([result.current.retryFile('file-0'), result.current.retryFile('file-1')])
        await Promise.resolve()
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(xhr.requests).toHaveLength(1)
      await act(async () => {
        xhr.requests[0].respond(200, JSON.stringify({ documentId: 'doc-0', jobId: null, status: 'pending' }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      await act(async () => {
        xhr.requests[1].respond(200, JSON.stringify({ documentId: 'doc-1', jobId: null, status: 'pending' }))
        await pending
      })
      xhr.restore()

      expect(xhr.requests).toHaveLength(2)
      expect(xhr.requests.map((request) => (request.body as FormData).get('file'))).toEqual(files)
    })
  })
})
