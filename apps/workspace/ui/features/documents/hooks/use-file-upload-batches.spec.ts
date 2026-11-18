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

describe('useFileUpload — upload batches', () => {
  let xhr: FakeXhrHandle
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    uuidState.count = 0
    mockDocumentsStoreState.trackedFiles = []
    mockClient.getCollection.mockResolvedValue({ name: 'proj-collection' })
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)
    xhr = installFakeXhr()
  })

  afterEach(() => {
    xhr.restore()
    vi.unstubAllGlobals()
  })

  const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' })

  test('opens a batch, names it on every upload, and seals it with what wrote no row', async () => {
    const { result } = renderHook(() => useFileUpload({ collectionName: 'proj-collection', projectId: 'proj-1' }))
    const files = [pdf('EG.pdf'), pdf('OG.pdf'), pdf('Rechnung 7.pdf')]

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(files, {
        excludedByScreening: [[{ term: 'Personal', segment: 'Personalakten', kind: 'folder' }]],
      })
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })
    await act(async () => {
      xhr.requests[0]?.respond(200, JSON.stringify({ documentId: 'doc-1', jobId: 'job-1', status: 'pending' }))
      xhr.requests[1]?.respond(200, JSON.stringify({ documentId: 'doc-2', jobId: null, status: 'uploaded', unchanged: true }))
      await pending
    })

    const [openUrl, openInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(openUrl).toBe('/api/upload-batches')
    const opened = JSON.parse(String(openInit.body)) as Record<string, unknown>
    expect(opened).toMatchObject({ scope: 'project', projectId: 'proj-1', expectedCount: 2 })
    expect(opened.excluded).toEqual([
      { term: 'Personal', count: 1 },
      { term: 'Rechnung', count: 1 },
    ])
    expect(JSON.stringify(opened)).not.toContain('Rechnung 7.pdf')

    expect(xhr.requests.map((request) => (request.body as FormData).get('uploadBatchId'))).toEqual([opened.id, opened.id])

    const [sealUrl, sealInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(sealUrl).toBe(`/api/upload-batches/${String(opened.id)}/seal`)
    expect(JSON.parse(String(sealInit.body))).toEqual({ unchanged: 1, failed: 0 })
  })

  test('seals a file held because the document it replaces is held as neither failed nor arrived', async () => {
    const { result } = renderHook(() => useFileUpload({ collectionName: 'proj-collection', projectId: 'proj-1' }))

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([pdf('EG.pdf'), pdf('OG.pdf')])
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })
    await act(async () => {
      xhr.requests[0]?.respond(200, JSON.stringify({ documentId: 'doc-1', jobId: 'job-1', status: 'pending' }))
      xhr.requests[1]?.respond(
        409,
        JSON.stringify({ error: 'waiting in quarantine', code: 'CONFLICT', details: { reason: 'quarantined', documentId: 'doc-held', ownUpload: false } })
      )
      await pending
    })

    const [, sealInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(sealInit.body))).toEqual({ unchanged: 0, failed: 0 })
  })

  test('a file the server’s name check stops is not uploaded, not failed, and counted by term', async () => {
    const { result } = renderHook(() => useFileUpload({ collectionName: 'proj-collection', projectId: 'proj-1' }))

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([pdf('EG.pdf'), pdf('scan_0042.pdf')])
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })
    await act(async () => {
      xhr.requests[0]?.respond(200, JSON.stringify({ documentId: 'doc-1', jobId: 'job-1', status: 'pending' }))
      xhr.requests[1]?.respond(
        422,
        JSON.stringify({
          error: 'This file is excluded by the organization’s upload screening',
          code: 'UPLOAD_SCREENED',
          details: { matches: [{ term: 'Personal', segment: 'Personalakten', kind: 'folder' }] },
        })
      )
      await pending
    })

    expect(xhr.requests).toHaveLength(2)
    expect(mockDocumentsStoreState.dismissTrackedFiles).toHaveBeenCalledWith(['mock-uuid-1'])
    expect(
      mockDocumentsStoreState.trackedFiles.filter((file) => (file as { status?: string }).status === 'failed')
    ).toEqual([])
    const said = vi.mocked(mockDocumentsStoreState.setError).mock.calls.at(-1)?.[0]
    expect(said).toContain('scan_0042.pdf')
    expect(said).toContain('not uploaded')
    expect(said).not.toContain('excluded by the organization')

    const [sealUrl, sealInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(sealUrl).toMatch(/\/seal$/)
    const sealed = JSON.parse(String(sealInit.body)) as Record<string, unknown>
    expect(sealed).toEqual({ unchanged: 0, failed: 0, excluded: [{ term: 'Personal', count: 1 }] })
    expect(String(sealInit.body)).not.toContain('scan_0042')
  })

  test('uploads without a batch when it cannot be opened', async () => {
    fetchMock.mockReset().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    const { result } = renderHook(() => useFileUpload({ collectionName: 'proj-collection', projectId: 'proj-1' }))

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([pdf('EG.pdf')])
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })
    await act(async () => {
      xhr.last().respond(200, JSON.stringify({ documentId: 'doc-1', jobId: 'job-1', status: 'pending' }))
      await pending
    })

    expect(xhr.requests).toHaveLength(1)
    expect((xhr.last().body as FormData).get('uploadBatchId')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
