import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
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

  test('does not send a file the office screens out, and says which and why', async () => {
    const { result } = renderUpload()
    const invoice = new File(['x'], 'Schlussrechnung 03.pdf', { type: 'application/pdf' })
    const plan = new File(['x'], 'Grundriss EG.pdf', { type: 'application/pdf' })

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([invoice, plan])
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests.forEach((request, i) => request.respond(200, uploadOk(`doc-${i}`)))
      await pending
    })

    expect(xhr.requests.map((request) => (request.body as FormData).get('file'))).toEqual([plan])
    expect(mockDocumentsStoreState.setError).toHaveBeenCalledWith(expect.stringContaining('Schlussrechnung 03.pdf'))
    expect(mockDocumentsStoreState.setError).toHaveBeenCalledWith(expect.stringContaining('Rechnung'))
  })

  test('offers „Trotzdem hochladen" for the stopped files, which sends them released', async () => {
    const { result } = renderUpload()
    const control = new File(['x'], 'Schlussrechnung 04.pdf', { type: 'application/pdf' })
    const plan = new File(['x'], 'Grundriss EG.pdf', { type: 'application/pdf' })

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([control, plan])
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests.forEach((request, i) => request.respond(200, uploadOk(`doc-${i}`)))
      await pending
    })
    const offer = mockDocumentsStoreState.setNameStopped.mock.calls.at(-1)?.[0] as
      | { count: number; uploadAnyway: () => void }
      | null
    expect(offer?.count).toBe(1)
    expect(xhr.requests).toHaveLength(1)

    await act(async () => {
      offer?.uploadAnyway()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      xhr.last().respond(200, uploadOk('doc-anyway'))
      await Promise.resolve()
    })

    expect(xhr.requests).toHaveLength(2)
    expect((xhr.last().body as FormData).get('file')).toBe(control)
    expect((xhr.last().body as FormData).get('screeningRelease')).toBe('name')
  })

  test('sends nothing, not even a clean file, while the office policy cannot be read', async () => {
    const { loadUploadScreeningPolicy, UploadScreeningPolicyUnavailableError } = await import(
      '@/adapters/api/upload-screening-policy'
    )
    vi.mocked(loadUploadScreeningPolicy).mockRejectedValueOnce(new UploadScreeningPolicyUnavailableError())
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { result } = renderUpload()

    await act(async () => {
      await result.current.uploadFiles([new File(['x'], 'Grundriss EG.pdf', { type: 'application/pdf' })])
    })

    expect(xhr.requests).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockClient.getCollection).not.toHaveBeenCalled()
    expect(mockDocumentsStoreState.trackedFiles).toEqual([])
    expect(mockDocumentsStoreState.setError).toHaveBeenCalledWith(filesCopy.messages.en.errors.screeningPolicyUnavailable)
    fetchSpy.mockRestore()
  })

  test('screens against the folder a file lands in', async () => {
    const { result } = renderUpload()
    const scan = new File(['x'], '0042.pdf', { type: 'application/pdf' })

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([scan], { folderPathFor: () => 'Verwaltung/Honorare' })
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests.forEach((request, i) => request.respond(200, uploadOk(`doc-${i}`)))
      await pending
    })

    expect(xhr.requests).toHaveLength(0)
    expect(mockDocumentsStoreState.setError).toHaveBeenCalledWith(expect.stringContaining('Honorare'))
  })

  test('sends a file the reader released, and tells the server it was released', async () => {
    const { result } = renderUpload()
    const contract = new File(['x'], 'Architektenvertrag.pdf', { type: 'application/pdf' })

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([contract], { screeningReleased: (file) => file === contract })
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      xhr.last().respond(200, uploadOk('doc-1'))
      await pending
    })

    expect(xhr.requests).toHaveLength(1)
    expect((xhr.last().body as FormData).get('screeningRelease')).toBe('name')
  })
})
