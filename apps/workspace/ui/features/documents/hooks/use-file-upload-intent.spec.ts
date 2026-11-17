import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'

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

import { installFakeXhr, type FakeXhrHandle } from '@/test-utils/xhr-mock'
import { renderUpload, uploadOk } from './use-file-upload.fixtures'

describe('useFileUpload — durable document uploads', () => {
  let xhr: FakeXhrHandle

  beforeEach(() => {
    vi.clearAllMocks()
    uuidState.count = 0
    mockDocumentsStoreState.trackedFiles = []
    mockClient.getCollection.mockResolvedValue({ name: 'proj-collection' })
    xhr = installFakeXhr()
  })

  afterEach(() => {
    xhr.restore()
    vi.clearAllMocks()
  })

  test('sends the document a file is filed as the new Fassung of, and only for that file (ADR-0099)', async () => {
    const { result } = renderUpload()
    const filed = new File(['x'], 'EG_Grundriss_Index_C.pdf', { type: 'application/pdf' })
    const plain = new File(['x'], 'Baubeschreibung.pdf', { type: 'application/pdf' })

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([filed, plain], { revisionOf: (file) => (file === filed ? 'doc-older' : null) })
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests.forEach((request, i) => request.respond(200, uploadOk(`doc-${i}`)))
      await pending
    })

    const bodies = new Map(xhr.requests.map((request) => [(request.body as FormData).get('file'), request.body as FormData]))
    expect(bodies.get(filed)?.get('revisionOf')).toBe('doc-older')
    expect(bodies.get(plain)?.has('revisionOf')).toBe(false)
  })

  test('retries a file into the same Fassung it was filed as', async () => {
    const filed = new File(['x'], 'EG_Grundriss_Index_C.pdf', { type: 'application/pdf' })
    mockDocumentsStoreState.trackedFiles = [
      {
        id: 'failed-1',
        file: filed,
        fileName: filed.name,
        fileSize: filed.size,
        status: 'failed',
        progress: 0,
        collectionName: 'proj-collection',
        uploadedAt: new Date().toISOString(),
        uploadIntent: { folderId: null, folderPath: null, screeningReleased: false, revisionOf: 'doc-older' },
      },
    ]
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.retryFile('failed-1')
      for (let i = 0; i < 5; i += 1) await Promise.resolve()
    })
    await act(async () => {
      xhr.last().respond(200, uploadOk('doc-1'))
      await pending
    })

    expect((xhr.last().body as FormData).get('revisionOf')).toBe('doc-older')
  })

  test('records where each file went and what the reader released, for a retry to repeat', async () => {
    const { result } = renderUpload({ folderId: 'folder-here' })
    const contract = new File(['x'], 'Architektenvertrag.pdf', { type: 'application/pdf' })

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([contract], {
        folderIdFor: () => 'folder-vertraege',
        folderPathFor: () => 'Verwaltung/Verträge',
        screeningReleased: (file) => file === contract,
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      xhr.last().respond(200, uploadOk('doc-1'))
      await pending
    })

    expect(mockDocumentsStoreState.addTrackedFile).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadIntent: { folderId: 'folder-vertraege', folderPath: 'Verwaltung/Verträge', screeningReleased: true },
      })
    )
  })

  test('retries a released file into its own folder, released again, not where the reader stands now', async () => {
    const contract = new File(['x'], 'Architektenvertrag.pdf', { type: 'application/pdf' })
    mockDocumentsStoreState.trackedFiles = [
      {
        id: 'failed-1',
        file: contract,
        fileName: contract.name,
        fileSize: contract.size,
        status: 'failed',
        progress: 0,
        collectionName: 'proj-collection',
        uploadedAt: new Date().toISOString(),
        uploadIntent: { folderId: 'folder-vertraege', folderPath: 'Verwaltung/Verträge', screeningReleased: true },
      },
    ]
    const { result } = renderUpload({ folderId: 'folder-elsewhere' })

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.retryFile('failed-1')
      for (let i = 0; i < 5; i += 1) await Promise.resolve()
    })
    await act(async () => {
      xhr.last().respond(200, uploadOk('doc-1'))
      await pending
    })

    expect(xhr.requests).toHaveLength(1)
    const body = xhr.last().body as FormData
    expect(body.get('screeningRelease')).toBe('name')
    expect(body.get('folderId')).toBe('folder-vertraege')
  })
})
