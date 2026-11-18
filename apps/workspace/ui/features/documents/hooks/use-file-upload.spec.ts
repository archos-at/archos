import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

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

import { useFileUpload } from './use-file-upload'
import { installFakeXhr, type FakeXhrHandle } from '@/test-utils/xhr-mock'
import { UPLOAD_CONCURRENCY } from '../lib/upload-queue'
import { CHAT, makeFile, makeFiles, renderUpload, uploadOk, FILE_BYTES } from './use-file-upload.fixtures'

describe('useFileUpload — durable document uploads', () => {
  let xhr: FakeXhrHandle

  const trackedById = (id: string) =>
    mockDocumentsStoreState.trackedFiles.find((f) => (f as { id?: string }).id === id) as
      | Record<string, unknown>
      | undefined

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

  test('sends several at once instead of one after another', async () => {
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(6))
      await Promise.resolve()
    })

    expect(xhr.requests.length).toBe(UPLOAD_CONCURRENCY)

    await act(async () => {
      for (let round = 0; round < 3; round += 1) {
        xhr.requests.filter((r) => r.status === 0).forEach((r, i) => r.respond(200, uploadOk(`doc-${round}-${i}`)))
        await Promise.resolve()
        await Promise.resolve()
      }
      await pending
    })

    expect(xhr.requests).toHaveLength(6)
  })

  test('records the bytes the browser reports, not a stand-in value', async () => {
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
    })

    await act(async () => {
      xhr.last().emitProgress(600, 1200)
      xhr.last().respond(200, uploadOk('doc-0'))
      await pending
    })

    expect(mockDocumentsStoreState.setUploadProgress).toHaveBeenCalledWith('mock-uuid', FILE_BYTES / 2)
    expect(trackedById('mock-uuid')).toMatchObject({ bytesUploaded: FILE_BYTES, status: 'ingesting' })
  })

  test('marks a file as uploading only once it has a slot', async () => {
    const { result } = renderUpload()

    await act(async () => {
      void result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
    })

    expect(trackedById('mock-uuid')).toMatchObject({ uploadStartedAt: expect.any(Number) })
    await act(async () => {
      xhr.last().respond(200, uploadOk('doc-0'))
    })
  })

  test('a rate-limited file waits out Retry-After and goes again instead of failing', async () => {
    vi.useFakeTimers()
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests[0].respond(429, JSON.stringify({ error: 'Too many requests' }), { 'Retry-After': '2' })
      await vi.advanceTimersByTimeAsync(2_000)
    })
    await act(async () => {
      xhr.requests[1].respond(200, uploadOk('doc-1'))
      await pending
    })
    vi.useRealTimers()

    expect(xhr.requests).toHaveLength(2)
    expect(mockDocumentsStoreState.updateTrackedFile).not.toHaveBeenCalledWith(
      'mock-uuid',
      expect.objectContaining({ status: 'failed' })
    )
  })

  test('cancelling aborts the transfer instead of letting it finish invisibly', async () => {
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
    })

    await act(async () => {
      result.current.cancelFile('mock-uuid')
      await pending
    })

    expect(xhr.last().aborted).toBe(true)
    expect(mockDocumentsStoreState.updateTrackedFile).toHaveBeenCalledWith('mock-uuid', { status: 'canceled' })
    expect(mockDocumentsStoreState.updateTrackedFile).not.toHaveBeenCalledWith(
      'mock-uuid',
      expect.objectContaining({ status: 'failed' })
    )
  })

  test('cancelling everything aborts every request in flight', async () => {
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(3))
      await Promise.resolve()
    })

    await act(async () => {
      result.current.cancelUpload()
      await pending
    })

    expect(xhr.requests.every((request) => request.aborted)).toBe(true)
  })
})

describe('useFileUpload — chat attachments', () => {
  let xhr: FakeXhrHandle
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    uuidState.count = 0
    mockDocumentsStoreState.trackedFiles = []
    xhr = installFakeXhr()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    xhr.restore()
    vi.unstubAllGlobals()
  })

  test('a cancel is not a failure', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useFileUpload({ collectionName: CHAT, onError }))

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([makeFile()])
      await Promise.resolve()
    })
    await act(async () => {
      result.current.cancelFile('mock-uuid')
      await pending
    })

    expect(onError).not.toHaveBeenCalled()
    expect(mockDocumentsStoreState.updateTrackedFile).toHaveBeenCalledWith('mock-uuid', { status: 'canceled' })
  })
})
