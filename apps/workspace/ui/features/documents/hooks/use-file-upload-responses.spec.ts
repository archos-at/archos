import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { filesCopy } from '@/i18n/namespaces/files'
import { capturePosthog } from '@/lib/analytics/posthog'

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
import { makeFiles, renderUpload, uploadOk } from './use-file-upload.fixtures'

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

  test('posts each file to the documents endpoint, carrying the target folder', async () => {
    const { result } = renderUpload({ folderId: 'folder-9' })

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(2))
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests.forEach((request, i) => request.respond(200, uploadOk(`doc-${i}`)))
      await pending
    })

    expect(xhr.requests).toHaveLength(2)
    expect(xhr.requests[0].url).toBe('/api/documents/upload')
    const body = xhr.requests[0].body as FormData
    expect(body.get('projectId')).toBe('proj-1')
    expect(body.get('folderId')).toBe('folder-9')
  })

  test('resolves with how many files the server took, so a caller never counts a refused one', async () => {
    const { result } = renderUpload()

    let pending!: Promise<number>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(2))
      await Promise.resolve()
    })
    let taken = -1
    await act(async () => {
      xhr.requests[0].respond(200, uploadOk('doc-0'))
      xhr.requests[1].respond(422, JSON.stringify({ error: 'Unsupported' }))
      taken = await pending
    })

    expect(taken).toBe(1)
    expect(await result.current.uploadFiles([])).toBe(0)
  })

  test('tells PostHog how many files of which types were taken, never their names', async () => {
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles([
        new File(['x'], 'Einreichplan-Haus-Meier.pdf', { type: 'application/pdf' }),
        new File(['x'], 'Statik.docx'),
        new File(['x'], 'Deckblatt.pdf', { type: 'application/pdf' }),
      ])
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests.forEach((request, i) => request.respond(200, uploadOk(`doc-${i}`)))
      await pending
    })

    expect(capturePosthog).toHaveBeenCalledTimes(1)
    expect(capturePosthog).toHaveBeenCalledWith('document_uploaded', {
      count: 3,
      source: 'web_batch',
      file_count: 3,
      types: 'docx,pdf',
      shelf: 'project',
    })
    expect(JSON.stringify(vi.mocked(capturePosthog).mock.calls)).not.toMatch(/Meier|Einreichplan/)
  })

  test('counts only the files the server took', async () => {
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(2))
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests[0]!.respond(200, uploadOk('doc-0'))
      xhr.requests[1]!.respond(500, JSON.stringify({ error: 'boom' }))
      await pending
    })

    expect(capturePosthog).toHaveBeenCalledWith('document_uploaded', expect.objectContaining({ count: 1 }))
  })

  test('carries the server’s „unchanged" answer onto the row, so it is not shown as a new upload', async () => {
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
    })
    await act(async () => {
      xhr.last().respond(
        200,
        JSON.stringify({ documentId: 'doc-1', jobId: null, status: 'uploaded', unchanged: true })
      )
      await pending
    })

    expect(mockDocumentsStoreState.updateTrackedFile).toHaveBeenCalledWith(
      'mock-uuid',
      expect.objectContaining({ status: 'success', serverFileId: 'doc-1', unchanged: true })
    )
  })

  test('one refused file does not take the batch down with it', async () => {
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(3))
      await Promise.resolve()
    })

    await act(async () => {
      xhr.requests[0].respond(413, JSON.stringify({ error: 'File too large', code: 'FILE_TOO_LARGE' }))
      xhr.requests[1].respond(200, uploadOk('doc-1'))
      xhr.requests[2].respond(200, uploadOk('doc-2'))
      await pending
    })

    expect(xhr.requests).toHaveLength(3)
    expect(mockDocumentsStoreState.updateTrackedFile).toHaveBeenCalledWith(
      'mock-uuid',
      expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('is larger than your office may upload'),
      })
    )
    expect(mockOrchestratorFns.enqueueJobs).toHaveBeenCalled()
  })

  test('a project closed while the tab was open is named in the reader’s language (ADR-0090)', async () => {
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests[0].respond(
        403,
        JSON.stringify({ error: 'This project is closed and can only be read.', code: 'FORBIDDEN', details: { reason: 'project-closed' } })
      )
      await pending
    })

    expect(mockDocumentsStoreState.updateTrackedFile).toHaveBeenCalledWith(
      'mock-uuid',
      expect.objectContaining({ status: 'failed', errorMessage: filesCopy.messages.en.errors.projectClosed })
    )
  })

  test('an upload that ran out of time says so in the dictionary, not in the transport’s English', async () => {
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests[0].timeOut()
      await pending
    })

    expect(mockDocumentsStoreState.updateTrackedFile).toHaveBeenCalledWith(
      'mock-uuid',
      expect.objectContaining({ status: 'failed', errorMessage: filesCopy.messages.en.errors.uploadTimeout })
    )
    expect(filesCopy.messages.en.errors.uploadTimeout).not.toMatch(/^Upload failed/)
  })

  test('a file refused because the document it would replace is held is held with it, not failed (ADR-0086)', async () => {
    const onError = vi.fn()
    const { result } = renderUpload({ onError })

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests[0].respond(
        409,
        JSON.stringify({
          error: '"plan-0.pdf" is waiting in quarantine.',
          code: 'CONFLICT',
          details: { reason: 'quarantined', documentId: 'doc-held', ownUpload: true },
        })
      )
      await pending
    })

    const message = filesCopy.messages.en.errors.quarantinedReplace.replace('{name}', 'plan-0.pdf')
    expect(trackedById('mock-uuid')).toMatchObject({
      status: 'held',
      errorMessage: message,
      retryable: false,
      replacesHeld: { documentId: 'doc-held', ownUpload: true },
    })
    expect(trackedById('mock-uuid')).not.toHaveProperty('serverFileId')
    expect(message).toMatch(/held back/)
    expect(mockDocumentsStoreState.setError).toHaveBeenCalledWith(message)
    expect(onError).not.toHaveBeenCalled()

    vi.mocked(mockDocumentsStoreState.removeTrackedFile).mockClear()
    const { result: again } = renderUpload()
    await act(async () => {
      await again.current.retryFile('mock-uuid')
    })
    expect(mockDocumentsStoreState.removeTrackedFile).not.toHaveBeenCalled()
    expect(xhr.requests).toHaveLength(1)
  })

  test('a taken name is said in the reader’s language, never the server’s English, and not retried', async () => {
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests[0].respond(
        409,
        JSON.stringify({
          error: 'A document named "plan-0.pdf" already exists here. Rename the file to upload it.',
          code: 'CONFLICT',
          details: { reason: 'name_taken' },
        })
      )
      await pending
    })

    const message = filesCopy.messages.en.errors.nameTaken.replace('{name}', 'plan-0.pdf')
    expect(trackedById('mock-uuid')).toMatchObject({ status: 'failed', errorMessage: message, retryable: false })
    expect(String(trackedById('mock-uuid')?.errorMessage)).not.toMatch(/already exists here/)
    expect(mockDocumentsStoreState.setError).toHaveBeenCalledWith(message)
  })

  test('a hidden held file and an ordinary taken name read the same', async () => {
    const answers = [
      'A document named "plan-0.pdf" already exists here. Rename the file to upload it.',
      'A document named "plan-0.pdf" already exists elsewhere in this project. Rename the file, or upload it where that document is filed.',
    ]
    const said: unknown[] = []
    for (const error of answers) {
      mockDocumentsStoreState.trackedFiles = []
      uuidState.count = 0
      const { result } = renderUpload()
      let pending!: Promise<unknown>
      await act(async () => {
        pending = result.current.uploadFiles(makeFiles(1))
        await Promise.resolve()
      })
      await act(async () => {
        xhr.last().respond(409, JSON.stringify({ error, code: 'CONFLICT', details: { reason: 'name_taken' } }))
        await pending
      })
      const { status, errorMessage, retryable, replacesHeld } = trackedById('mock-uuid') ?? {}
      said.push({ status, errorMessage, retryable, replacesHeld })
    }
    expect(said[0]).toEqual(said[1])
    expect(said[0]).toEqual({
      status: 'failed',
      errorMessage: filesCopy.messages.en.errors.nameTaken.replace('{name}', 'plan-0.pdf'),
      retryable: false,
      replacesHeld: undefined,
    })
  })

  test('a refusal with a reason this build does not know is not echoed in the server’s English', async () => {
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests[0].respond(409, JSON.stringify({ error: 'Some internal English', details: { reason: 'something_new' } }))
      await pending
    })

    expect(trackedById('mock-uuid')).toMatchObject({ status: 'failed', errorMessage: filesCopy.messages.en.errors.uploadFailed })
  })

  test('any other conflict stays retryable', async () => {
    const { result } = renderUpload()

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadFiles(makeFiles(1))
      await Promise.resolve()
    })
    await act(async () => {
      xhr.requests[0].respond(409, JSON.stringify({ error: 'A document named "plan-0.pdf" already exists here.' }))
      await pending
    })

    expect(trackedById('mock-uuid')).toMatchObject({ status: 'failed' })
    expect(trackedById('mock-uuid')).not.toHaveProperty('retryable')
  })
})
