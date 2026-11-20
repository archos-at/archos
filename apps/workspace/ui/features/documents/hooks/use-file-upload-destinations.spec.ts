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
import { makeFiles, renderUpload, uploadOk } from './use-file-upload.fixtures'

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

  test('creates the project collection when it does not exist yet', async () => {
    mockClient.getCollection.mockResolvedValue(null)
    mockClient.createCollection.mockResolvedValue({ name: 'proj-collection' })
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      xhr.last().respond(200, uploadOk('doc-0'))
      await pending
    })

    expect(mockClient.getCollection).toHaveBeenCalledWith('proj-collection')
    expect(mockClient.createCollection).toHaveBeenCalledWith(
      'proj-collection',
      'Documents for session proj-collection'
    )
  })

  test('deletes a project document through the first-party route, by document id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    mockDocumentsStoreState.trackedFiles = [
      { id: 'row-1', fileName: 'plan.pdf', collectionName: 'proj-collection', fileSize: 10, serverFileId: 'doc-1' },
    ] as unknown[]
    const { result } = renderUpload()

    await act(async () => {
      await result.current.deleteFile('row-1')
    })
    vi.unstubAllGlobals()

    expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc-1', { method: 'DELETE' })
    expect(mockClient.deleteFiles).not.toHaveBeenCalled()
  })

  test('the Archiv posts to its own endpoint and never names a project', async () => {
    const { result } = renderHook(() =>
      useFileUpload({ collectionName: 'archiv_org-1', officeShelf: true })
    )

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
    })
    await act(async () => {
      xhr.last().respond(200, uploadOk('doc-0'))
      await pending
    })

    expect(xhr.last().url).toBe('/api/documents/upload')
    expect((xhr.last().body as FormData).get('projectId')).toBeNull()
  })

  test('sends no flag that would route an Archiv upload to the norms: the server reads a norm from its name', async () => {
    const { result } = renderHook(() => useFileUpload({ collectionName: 'archiv_org-1', officeShelf: true }))
    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
    })
    await act(async () => {
      xhr.last().respond(200, uploadOk('doc-0'))
      await pending
    })
    expect((xhr.last().body as FormData).get('forStandards')).toBeNull()
  })

  test('the Archiv files into the folder the reader stands in, and records where a tree came from', async () => {
    const { result } = renderHook(() =>
      useFileUpload({ collectionName: 'archiv_org-1', officeShelf: true, folderId: 'folder-3' })
    )
    const [file] = makeFiles(1)
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Planung/EG/plan-0.pdf' })

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([file])
      await Promise.resolve()
    })
    await act(async () => {
      xhr.last().respond(200, uploadOk('doc-0'))
      await pending
    })

    const body = xhr.last().body as FormData
    expect(body.get('folderId')).toBe('folder-3')
    expect(body.get('originPath')).toBe('Planung/EG/plan-0.pdf')
    expect(body.get('projectId')).toBeNull()
  })

  test('a folder upload files each Archiv document into its own folder', async () => {
    const { result } = renderHook(() =>
      useFileUpload({ collectionName: 'archiv_org-1', officeShelf: true, folderId: 'folder-3' })
    )
    const files = makeFiles(2)

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(files, {
        folderIdFor: (file) => (file === files[0] ? 'folder-a' : null),
      })
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests.forEach((request, i) => request.respond(200, uploadOk(`doc-${i}`)))
      await pending
    })

    expect((xhr.requests[0].body as FormData).get('folderId')).toBe('folder-a')
    expect((xhr.requests[1].body as FormData).get('folderId')).toBeNull()
  })
})
