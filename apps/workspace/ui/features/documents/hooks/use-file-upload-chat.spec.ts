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
import { CHAT, makeFile } from './use-file-upload.fixtures'

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

  const renderChat = () =>
    renderHook(() => useFileUpload({ collectionName: CHAT, conversationProjectId: 'proj-7' }))

  async function upload(result: ReturnType<typeof renderChat>['result'], respond: () => void) {
    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([makeFile()])
      await Promise.resolve()
    })
    await act(async () => {
      respond()
      await pending
    })
  }

  test('posts each file to the session upload route, naming the chat and its project', async () => {
    const { result } = renderChat()

    await upload(result, () =>
      xhr.last().respond(200, JSON.stringify({ documentId: 'doc-1', jobId: 'job-1', status: 'pending' }))
    )

    expect(xhr.requests).toHaveLength(1)
    expect(xhr.last().url).toBe('/api/session/documents/upload')
    const body = xhr.last().body as FormData
    expect(body.get('conversationId')).toBe(CHAT)
    expect(body.get('projectId')).toBe('proj-7')
    expect(body.get('file')).toBeInstanceOf(File)
  })

  test('sends a dropped folder’s path along, so the server screens what the browser screened', async () => {
    const { result } = renderChat()
    const file = makeFile()
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Baustelle/Fotos/plan.pdf' })

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([file])
      await Promise.resolve()
    })
    await act(async () => {
      xhr.last().respond(200, JSON.stringify({ documentId: 'doc-1', jobId: 'job-1', status: 'pending' }))
      await pending
    })

    expect((xhr.last().body as FormData).get('originPath')).toBe('Baustelle/Fotos/plan.pdf')
  })

  test('never touches the proxy: no collection lookup, no collection create', async () => {
    const { result } = renderChat()

    await upload(result, () =>
      xhr.last().respond(200, JSON.stringify({ documentId: 'doc-1', jobId: 'job-1', status: 'pending' }))
    )

    expect(mockClient.getCollection).not.toHaveBeenCalled()
    expect(mockClient.createCollection).not.toHaveBeenCalled()
    expect(xhr.requests.some((request) => request.url.includes('/api/v1/'))).toBe(false)
    expect(fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => !url.startsWith('/api/upload-batches'))).toEqual([])
    expect(mockMarkSessionHasCollection).toHaveBeenCalledWith(CHAT)
  })

  test('files the row under its document id and polls the chat by re-listing it', async () => {
    const { result } = renderChat()

    await upload(result, () =>
      xhr.last().respond(200, JSON.stringify({ documentId: 'doc-1', jobId: 'job-1', status: 'pending' }))
    )

    expect(mockDocumentsStoreState.updateTrackedFile).toHaveBeenCalledWith(
      'mock-uuid',
      expect.objectContaining({ status: 'ingesting', serverFileId: 'doc-1' })
    )
    expect(mockOrchestratorFns.pollSessionDocuments).toHaveBeenCalledWith(CHAT)
    expect(mockOrchestratorFns.enqueueJobs).not.toHaveBeenCalled()
  })

  test('shows the server’s refusal (type gate, quota) on the row that was refused', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useFileUpload({ collectionName: CHAT, onError }))

    await upload(result, () =>
      xhr.last().respond(507, JSON.stringify({ error: 'Storage quota exceeded', code: 'STORAGE_QUOTA_EXCEEDED' }))
    )

    expect(mockDocumentsStoreState.updateTrackedFile).toHaveBeenCalledWith(
      'mock-uuid',
      expect.objectContaining({ status: 'failed', errorMessage: filesCopy.messages.en.errors.uploadStorageFull })
    )
    expect(mockDocumentsStoreState.setError).toHaveBeenCalledWith(filesCopy.messages.en.errors.uploadStorageFull)
    expect(onError).toHaveBeenCalled()
    expect(mockOrchestratorFns.pollSessionDocuments).not.toHaveBeenCalled()
  })

  describe('stopping a read', () => {
    const reading = { id: 'row-1', fileName: 'a.pdf', collectionName: CHAT, fileSize: 1, status: 'ingesting', serverFileId: 'doc-1' }
    const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    const canceledWrite = ['row-1', { status: 'canceled' }] as const

    function stubStop(documentStatus: string, meanwhile: () => void = () => {}) {
      fetchMock.mockImplementation(async (url: string) => {
        if (!url.endsWith('/cancel')) throw new Error(`unexpected request after the stop: ${url}`)
        meanwhile()
        return answer({ id: 'doc-1', result: 'cancelled', status: documentStatus })
      })
    }

    async function stop() {
      mockDocumentsStoreState.trackedFiles = [reading] as unknown[]
      const { result } = renderChat()
      await act(async () => {
        result.current.cancelFile('row-1')
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }

    test('a row still being read when the stop is confirmed says cancelled', async () => {
      stubStop('cancelled')
      await stop()
      expect(mockDocumentsStoreState.updateTrackedFile).toHaveBeenCalledWith(...canceledWrite)
    })

    test('a row that finished reading while the stop was out keeps what it says', async () => {
      stubStop('completed', () => mockDocumentsStoreState.updateTrackedFile('row-1', { status: 'success' }))
      await stop()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(mockDocumentsStoreState.updateTrackedFile).not.toHaveBeenCalledWith(...canceledWrite)
      expect((mockDocumentsStoreState.trackedFiles[0] as { status: string }).status).toBe('success')
    })

    test('a row a stale report settled says cancelled once the document itself does', async () => {
      stubStop('cancelled', () => mockDocumentsStoreState.updateTrackedFile('row-1', { status: 'success' }))
      await stop()
      expect(mockDocumentsStoreState.updateTrackedFile).toHaveBeenCalledWith(...canceledWrite)
    })
  })

  test('deletes an attachment through the session document route, by document id', async () => {
    mockDocumentsStoreState.trackedFiles = [
      { id: 'row-1', fileName: 'plan.pdf', collectionName: CHAT, fileSize: 1000, serverFileId: 'doc-1' },
    ] as unknown[]
    fetchMock.mockResolvedValue({ ok: true, status: 204 })
    const { result } = renderChat()

    await act(async () => {
      await result.current.deleteFile('row-1')
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/session/documents/doc-1', { method: 'DELETE' })
    expect(mockClient.deleteFiles).not.toHaveBeenCalled()
    expect(mockDocumentsStoreState.removeTrackedFile).toHaveBeenCalledWith('row-1')
  })

  test('restores the attachment and says why when the delete is refused', async () => {
    const file = { id: 'row-1', fileName: 'plan.pdf', collectionName: CHAT, fileSize: 1000, serverFileId: 'doc-1' }
    mockDocumentsStoreState.trackedFiles = [file] as unknown[]
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { message: 'Legal hold' } }),
    })
    const { result } = renderChat()

    await act(async () => {
      await result.current.deleteFile('row-1')
    })

    expect(mockDocumentsStoreState.addTrackedFile).toHaveBeenCalledWith(file)
    expect(mockDocumentsStoreState.setError).toHaveBeenCalledWith('Legal hold')
  })

  test('a file that never reached the server is only dropped from the list', async () => {
    mockDocumentsStoreState.trackedFiles = [
      { id: 'row-1', fileName: 'plan.pdf', collectionName: CHAT, fileSize: 1000, status: 'failed' },
    ] as unknown[]
    const { result } = renderChat()

    await act(async () => {
      await result.current.deleteFile('row-1')
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockDocumentsStoreState.removeTrackedFile).toHaveBeenCalledWith('row-1')
  })
})
