/**
 * @vitest-environment node
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { FALLBACK_POLL_MS, UploadOrchestrator } from './orchestrator'
import { onDocumentsChanged } from '@/lib/documents/document-changes'
import { getStoreTranslator } from '@/i18n/store-translator'
import { filesCopy } from '@/i18n/namespaces/files'
import type { TrackedFile } from './types'

const mockToast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: mockToast }))

const STILL_READING = getStoreTranslator(filesCopy)('uploads.stillReading')

const mockClient = {
  getCollection: vi.fn(),
  listFiles: vi.fn(),
  getJobStatus: vi.fn(),
  createCollection: vi.fn(),
  uploadFiles: vi.fn(),
  deleteFiles: vi.fn(),
}

vi.mock('@/adapters/api', () => ({
  createDocumentsClient: () => mockClient,
}))

const mockListSessionDocuments = vi.fn()
vi.mock('@/adapters/api/session-documents-client', () => ({
  listSessionDocuments: (...args: unknown[]) => mockListSessionDocuments(...args),
}))

const mockDocumentsStore = {
  clearFilesForCollection: vi.fn(),
  setFilesFromServer: vi.fn(),
  addTrackedFile: vi.fn(),
  setCurrentCollection: vi.fn(),
  setCollectionInfo: vi.fn(),
  setPolling: vi.fn(),
  setActiveJobId: vi.fn(),
  setError: vi.fn(),
  clearError: vi.fn(),
  updateFilesFromJobStatus: vi.fn(),
  updateTrackedFile: vi.fn(),
  setLoadingFiles: vi.fn(),
  trackedFiles: [] as TrackedFile[],
  isUploading: false,
  isPolling: false,
  shownBannersForJobs: {},
  markBannerShown: vi.fn(),
}

vi.mock('./store', () => ({
  useDocumentsStore: {
    getState: () => mockDocumentsStore,
  },
}))

const mockLayoutStore = {
  setDataSourcesPanelTab: vi.fn(),
  knowledgeLayerAvailable: true,
}

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: {
    getState: () => mockLayoutStore,
  },
}))

vi.mock('@/features/chat/store', () => ({
  useChatStore: {
    getState: () => ({}),
  },
}))

const mockSessionHasKnownCollection = vi.fn((_sessionId: string): boolean => false)
const mockMarkSessionHasCollection = vi.fn((_sessionId: string): void => undefined)
const mockUnmarkSessionCollection = vi.fn((_sessionId: string): void => undefined)
const mockGetPersistedJobForCollection = vi.fn(
  (_collectionName: string): ReturnType<typeof import('./persistence').getPersistedJobForCollection> => null
)

vi.mock('./persistence', () => ({
  persistJob: vi.fn(),
  removePersistedJob: vi.fn(),
  getPersistedJobForCollection: (name: string) => mockGetPersistedJobForCollection(name),
  updatePersistedJobFiles: vi.fn(),
  sessionHasKnownCollection: (id: string) => mockSessionHasKnownCollection(id),
  markSessionHasCollection: (id: string) => mockMarkSessionHasCollection(id),
  unmarkSessionCollection: (id: string) => mockUnmarkSessionCollection(id),
  removePersistedJobForCollection: vi.fn(),
}))

describe('UploadOrchestrator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockSessionHasKnownCollection.mockReturnValue(false)
    mockMarkSessionHasCollection.mockReturnValue(undefined)
    mockUnmarkSessionCollection.mockReturnValue(undefined)
    mockGetPersistedJobForCollection.mockReturnValue(null)
    mockDocumentsStore.trackedFiles = []
    UploadOrchestrator.cleanup()
  })

  afterEach(() => {
    vi.useRealTimers()
    UploadOrchestrator.cleanup()
  })

  describe('setAuthToken', () => {
    test('sets auth token for client creation', () => {
      UploadOrchestrator.setAuthToken('test-token')
    })

    test('handles undefined token', () => {
      UploadOrchestrator.setAuthToken(undefined)
    })
  })

  describe('subscribe', () => {
    const completedJob = {
      job_id: 'job-1',
      status: 'completed',
      file_details: [{ file_id: 'file-1', file_name: 'test.pdf', status: 'completed', progress_percent: 100 }],
    }

    test('every subscriber hears a completion, not only the last to subscribe', async () => {
      mockClient.getJobStatus.mockResolvedValue(completedJob)
      mockClient.listFiles.mockResolvedValue([])
      const composer = vi.fn()
      const filesTab = vi.fn()
      const offComposer = UploadOrchestrator.subscribe({ onComplete: composer })
      const offFilesTab = UploadOrchestrator.subscribe({ onComplete: filesTab })

      UploadOrchestrator.startPolling('job-1', 'session-1')
      await vi.advanceTimersByTimeAsync(5000)

      expect(composer).toHaveBeenCalledTimes(1)
      expect(filesTab).toHaveBeenCalledTimes(1)
      offComposer()
      offFilesTab()
    })

    test('an unsubscribed listener is not called, and the rest still are', async () => {
      mockClient.getJobStatus.mockResolvedValue({
        job_id: 'job-1',
        status: 'failed',
        error_message: 'Upload failed',
        file_details: [],
      })
      const gone = vi.fn()
      const stays = vi.fn()
      const offGone = UploadOrchestrator.subscribe({ onError: gone })
      const offStays = UploadOrchestrator.subscribe({ onError: stays })
      offGone()

      UploadOrchestrator.startPolling('job-1', 'session-1')
      await vi.advanceTimersByTimeAsync(5000)

      expect(gone).not.toHaveBeenCalled()
      expect(stays).toHaveBeenCalledWith(new Error('Upload failed'))
      offStays()
    })

    test('a subscriber that throws does not keep the next one from hearing', async () => {
      mockClient.getJobStatus.mockResolvedValue(completedJob)
      mockClient.listFiles.mockResolvedValue([])
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const after = vi.fn()
      const offThrows = UploadOrchestrator.subscribe({
        onComplete: () => {
          throw new Error('boom')
        },
      })
      const offAfter = UploadOrchestrator.subscribe({ onComplete: after })

      UploadOrchestrator.startPolling('job-1', 'session-1')
      await vi.advanceTimersByTimeAsync(5000)

      expect(after).toHaveBeenCalledTimes(1)
      offThrows()
      offAfter()
      warn.mockRestore()
    })

    test('a terminal job tells the document listings, success or failure', async () => {
      const changed = vi.fn()
      const off = onDocumentsChanged(changed)
      mockClient.getJobStatus.mockResolvedValue({
        job_id: 'job-1',
        status: 'failed',
        error_message: 'Upload failed',
        file_details: [],
      })

      UploadOrchestrator.startPolling('job-1', 'session-1')
      expect(changed).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(5000)

      expect(changed).toHaveBeenCalledTimes(1)
      off()
    })
  })

  describe('handleSessionChange', () => {
    test('does nothing when session is the same', async () => {
      await UploadOrchestrator.handleSessionChange('session-1')
      mockDocumentsStore.clearFilesForCollection.mockClear()

      await UploadOrchestrator.handleSessionChange('session-1')

      expect(mockDocumentsStore.clearFilesForCollection).not.toHaveBeenCalled()
    })

    test('clears files when switching sessions', async () => {
      await UploadOrchestrator.handleSessionChange('session-1')
      mockDocumentsStore.clearFilesForCollection.mockClear()

      await UploadOrchestrator.handleSessionChange('session-2')

      expect(mockDocumentsStore.clearFilesForCollection).toHaveBeenCalledWith('session-1')
      expect(mockDocumentsStore.clearFilesForCollection).not.toHaveBeenCalledWith('session-2')
    })

    test('loads files for new session when session has known collection', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockClient.getCollection.mockResolvedValue({
        name: 'session-1',
        description: 'Test session',
      })
      mockClient.listFiles.mockResolvedValue([
        { file_id: 'file-1', file_name: 'test.pdf', status: 'completed' },
      ])

      await UploadOrchestrator.handleSessionChange('session-1')
      await vi.runAllTimersAsync()

      expect(mockClient.getCollection).toHaveBeenCalledWith('session-1')
    })

    test('skips loading files for new session without known collection', async () => {
      mockSessionHasKnownCollection.mockReturnValue(false)

      await UploadOrchestrator.handleSessionChange('session-1')
      await vi.runAllTimersAsync()

      expect(mockClient.getCollection).not.toHaveBeenCalled()
    })

    test('handles undefined session', async () => {
      await UploadOrchestrator.handleSessionChange('session-1')
      await UploadOrchestrator.handleSessionChange(undefined)

      expect(mockDocumentsStore.clearFilesForCollection).toHaveBeenCalledWith('session-1')
    })
  })

  describe('loadFilesForSession', () => {
    test('loads files from server when session has known collection', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockClient.getCollection.mockResolvedValue({
        name: 'session-1',
        description: 'Test session',
      })
      mockClient.listFiles.mockResolvedValue([
        { file_id: 'file-1', file_name: 'test.pdf', status: 'completed' },
      ])

      await UploadOrchestrator.handleSessionChange('session-1')

      expect(mockClient.getCollection).toHaveBeenCalledWith('session-1')
      expect(mockClient.listFiles).toHaveBeenCalledWith('session-1')
      expect(mockDocumentsStore.setFilesFromServer).toHaveBeenCalled()
      expect(mockMarkSessionHasCollection).toHaveBeenCalledWith('session-1')
    })

    test('skips API call when session has no known collection', async () => {
      mockSessionHasKnownCollection.mockReturnValue(false)

      await UploadOrchestrator.loadFilesForSession('session-1')

      expect(mockClient.getCollection).not.toHaveBeenCalled()
      expect(mockClient.listFiles).not.toHaveBeenCalled()
    })

    test('calls API when session has persisted job even without known collection', async () => {
      mockSessionHasKnownCollection.mockReturnValue(false)
      await UploadOrchestrator.handleSessionChange('session-1')
      await UploadOrchestrator.handleSessionChange('session-2')

      mockSessionHasKnownCollection.mockReturnValue(false)
      mockGetPersistedJobForCollection
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({
          jobId: 'job-1',
          collectionName: 'session-1',
          files: [],
          startedAt: Date.now(),
        })
      mockClient.getCollection.mockResolvedValue({
        name: 'session-1',
        description: 'Test session',
      })
      mockClient.listFiles.mockResolvedValue([])

      await UploadOrchestrator.handleSessionChange('session-1')

      expect(mockClient.getCollection).toHaveBeenCalledWith('session-1')
    })

    test('unmarks session when collection returns 404 (TTL expired)', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockClient.getCollection.mockResolvedValue(null)

      await UploadOrchestrator.handleSessionChange('session-1')

      expect(mockUnmarkSessionCollection).toHaveBeenCalledWith('session-1')
    })

    test('handles non-existent collection', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockClient.getCollection.mockResolvedValue(null)

      await UploadOrchestrator.handleSessionChange('session-1')

      expect(mockClient.listFiles).not.toHaveBeenCalled()
    })

    test('skips if already loaded for same session', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockClient.getCollection.mockResolvedValue({
        name: 'session-1',
        description: 'Test session',
      })
      mockClient.listFiles.mockResolvedValue([])

      await UploadOrchestrator.handleSessionChange('session-1')
      mockClient.getCollection.mockClear()

      await UploadOrchestrator.loadFilesForSession('session-1')

      expect(mockClient.getCollection).not.toHaveBeenCalled()
    })

    test('skips if currently uploading', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockDocumentsStore.isUploading = true

      await UploadOrchestrator.loadFilesForSession('session-1')

      expect(mockClient.getCollection).not.toHaveBeenCalled()
      mockDocumentsStore.isUploading = false
    })

    test('skips if currently polling', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockDocumentsStore.isPolling = true

      await UploadOrchestrator.loadFilesForSession('session-1')

      expect(mockClient.getCollection).not.toHaveBeenCalled()
      mockDocumentsStore.isPolling = false
    })

    test('handles errors gracefully without unmarking session', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockClient.getCollection.mockRejectedValue(new Error('Network error'))

      mockSessionHasKnownCollection.mockReturnValueOnce(false)
      await UploadOrchestrator.handleSessionChange('session-1')

      mockSessionHasKnownCollection.mockReturnValue(true)
      await UploadOrchestrator.loadFilesForSession('session-1')

      expect(mockUnmarkSessionCollection).not.toHaveBeenCalled()
    })
  })

  describe('resuming a persisted job after a reload', () => {
    const persistedRow = {
      id: 'row-1',
      fileName: 'Einreichplan.pdf',
      fileSize: 1,
      status: 'ingesting' as const,
      progress: 40,
      collectionName: 'project-1',
      jobId: 'job-1',
    }
    const jobWith = (status: string, fileStatus: string, errorMessage: string | null = null) => ({
      job_id: 'job-1',
      collection_name: 'project-1',
      status,
      file_details: [
        {
          file_id: 'file-1',
          file_name: 'Einreichplan.pdf',
          status: fileStatus,
          progress_percent: 40,
          error_message: errorMessage,
        },
      ],
    })

    beforeEach(() => {
      mockGetPersistedJobForCollection.mockReturnValue({
        jobId: 'job-1',
        collectionName: 'project-1',
        files: [persistedRow],
        startedAt: Date.now(),
      })
      mockClient.listFiles.mockResolvedValue([])
    })

    test('a job still running gets its rows back', async () => {
      mockClient.getJobStatus.mockResolvedValue(jobWith('processing', 'ingesting'))

      await UploadOrchestrator.handleSessionChange('project-1')

      expect(mockDocumentsStore.addTrackedFile).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'row-1', status: 'ingesting', serverFileId: 'file-1' })
      )
    })

    test.each([
      ['completed', 'success', null],
      ['failed', 'failed', 'original_download_failed: gone'],
      ['cancelled', 'failed', 'cancelled: ingestion was stopped; start it again to index this file'],
    ])('a %s job does not get its rows back', async (status, fileStatus, errorMessage) => {
      mockClient.getJobStatus.mockResolvedValue(jobWith(status, fileStatus, errorMessage))

      await UploadOrchestrator.handleSessionChange('project-1')

      expect(mockDocumentsStore.addTrackedFile).not.toHaveBeenCalled()
    })
  })

  describe('refreshFilesForSession', () => {
    test('forces re-fetch by resetting cache for current session', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockClient.getCollection.mockResolvedValue({
        name: 'session-1',
        description: 'Test session',
      })
      mockClient.listFiles.mockResolvedValue([
        { file_id: 'file-1', file_name: 'test.pdf', status: 'completed' },
      ])

      await UploadOrchestrator.handleSessionChange('session-1')
      expect(mockClient.getCollection).toHaveBeenCalledTimes(1)
      mockClient.getCollection.mockClear()
      mockClient.listFiles.mockClear()

      await UploadOrchestrator.loadFilesForSession('session-1')
      expect(mockClient.getCollection).not.toHaveBeenCalled()

      await UploadOrchestrator.refreshFilesForSession('session-1')
      expect(mockClient.getCollection).toHaveBeenCalledWith('session-1')
      expect(mockClient.listFiles).toHaveBeenCalledWith('session-1')
    })

    test('does nothing for a different session than current', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockClient.getCollection.mockResolvedValue({
        name: 'session-1',
        description: 'Test session',
      })
      mockClient.listFiles.mockResolvedValue([])

      await UploadOrchestrator.handleSessionChange('session-1')
      mockClient.getCollection.mockClear()

      await UploadOrchestrator.refreshFilesForSession('session-2')
      expect(mockClient.getCollection).not.toHaveBeenCalled()
    })

    test('detects backend-side removal (404) and unmarks session', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockClient.getCollection.mockResolvedValue({
        name: 'session-1',
        description: 'Test session',
      })
      mockClient.listFiles.mockResolvedValue([
        { file_id: 'file-1', file_name: 'test.pdf', status: 'completed' },
      ])

      await UploadOrchestrator.handleSessionChange('session-1')
      mockUnmarkSessionCollection.mockClear()

      mockClient.getCollection.mockResolvedValue(null)

      await UploadOrchestrator.refreshFilesForSession('session-1')
      expect(mockUnmarkSessionCollection).toHaveBeenCalledWith('session-1')
    })
  })

  describe('startPolling', () => {
    test('starts polling for job status', () => {
      UploadOrchestrator.startPolling('job-1', 'session-1')

      expect(mockDocumentsStore.setPolling).toHaveBeenCalledWith(true)
      expect(mockDocumentsStore.setActiveJobId).toHaveBeenCalledWith('job-1')
    })

    test('stops existing polling before starting new one', () => {
      UploadOrchestrator.startPolling('job-1', 'session-1')
      UploadOrchestrator.startPolling('job-2', 'session-1')

      expect(mockDocumentsStore.setActiveJobId).toHaveBeenLastCalledWith('job-2')
    })
  })

  describe('stopPolling', () => {
    test('stops current polling', () => {
      UploadOrchestrator.startPolling('job-1', 'session-1')
      UploadOrchestrator.stopPolling()

      expect(mockDocumentsStore.setPolling).toHaveBeenCalledWith(false)
      expect(mockDocumentsStore.setActiveJobId).toHaveBeenCalledWith(null)
    })

    test('handles stop when not polling', () => {
      UploadOrchestrator.stopPolling()

      expect(mockDocumentsStore.setPolling).toHaveBeenCalledWith(false)
    })
  })

  describe('stopPollingIfCollection', () => {
    test('stops polling when collection matches', () => {
      UploadOrchestrator.startPolling('job-1', 'session-1')
      mockDocumentsStore.setPolling.mockClear()
      mockDocumentsStore.setActiveJobId.mockClear()

      UploadOrchestrator.stopPollingIfCollection('session-1')

      expect(mockDocumentsStore.setPolling).toHaveBeenCalledWith(false)
      expect(mockDocumentsStore.setActiveJobId).toHaveBeenCalledWith(null)
    })

    test('does not stop when collection differs', () => {
      UploadOrchestrator.startPolling('job-1', 'session-1')
      mockDocumentsStore.setPolling.mockClear()
      mockDocumentsStore.setActiveJobId.mockClear()

      UploadOrchestrator.stopPollingIfCollection('other-session')

      expect(mockDocumentsStore.setPolling).not.toHaveBeenCalled()
      expect(mockDocumentsStore.setActiveJobId).not.toHaveBeenCalled()
    })
  })

  describe('cleanup', () => {
    test('stops polling and clears state', () => {
      UploadOrchestrator.startPolling('job-1', 'session-1')
      UploadOrchestrator.cleanup()

      expect(mockDocumentsStore.setPolling).toHaveBeenCalledWith(false)
    })
  })

  describe('polling behavior', () => {
    test('polls job status on interval', async () => {
      mockClient.getJobStatus.mockResolvedValue({
        job_id: 'job-1',
        status: 'in_progress',
        file_details: [{ file_id: 'file-1', file_name: 'test.pdf', status: 'processing' }],
      })

      UploadOrchestrator.startPolling('job-1', 'session-1')

      await vi.advanceTimersByTimeAsync(5000)

      expect(mockClient.getJobStatus).toHaveBeenCalledWith('job-1', expect.any(AbortSignal))
    })

    test('stops polling when job completes', async () => {
      mockClient.getJobStatus.mockResolvedValue({
        job_id: 'job-1',
        status: 'completed',
        file_details: [
          { file_id: 'file-1', file_name: 'test.pdf', status: 'completed', progress_percent: 100 },
        ],
      })
      mockClient.listFiles.mockResolvedValue([])

      UploadOrchestrator.startPolling('job-1', 'session-1')
      await vi.advanceTimersByTimeAsync(5000)

      expect(mockDocumentsStore.setPolling).toHaveBeenLastCalledWith(false)
    })

    test('stops polling when job fails', async () => {
      mockClient.getJobStatus.mockResolvedValue({
        job_id: 'job-1',
        status: 'failed',
        error_message: 'Upload failed',
        file_details: [],
      })

      UploadOrchestrator.startPolling('job-1', 'session-1')
      await vi.advanceTimersByTimeAsync(5000)

      expect(mockDocumentsStore.setError).toHaveBeenCalledWith(getStoreTranslator(filesCopy)('ingestFailure.unknown'))
    })

    describe('when the orchestrator stops following a job', () => {
      const tray = (overrides: Partial<TrackedFile>): TrackedFile => ({
        id: 'row-1',
        fileName: 'Einreichplan.pdf',
        fileSize: 1,
        status: 'ingesting',
        progress: 0,
        jobId: 'job-1',
        serverFileId: 'doc-1',
        collectionName: 'session-1',
        ...overrides,
      })

      beforeEach(() => {
        mockDocumentsStore.trackedFiles = [
          tray({}),
          tray({ id: 'row-done', status: 'success' }),
          tray({ id: 'row-other-job', jobId: 'job-2' }),
        ]
      })

      const expectHandedOver = () => {
        expect(mockDocumentsStore.setError).not.toHaveBeenCalled()
        expect(mockDocumentsStore.updateTrackedFile).toHaveBeenCalledTimes(1)
        expect(mockDocumentsStore.updateTrackedFile).toHaveBeenCalledWith('row-1', {
          jobId: undefined,
          status: 'ingesting',
        })
        expect(mockToast.error).not.toHaveBeenCalled()
        expect(mockToast.info).toHaveBeenCalledWith(STILL_READING, expect.anything())
        expect(mockDocumentsStore.setPolling).toHaveBeenLastCalledWith(false)
      }

      test('an unknown job hands its rows to the listing', async () => {
        mockClient.getJobStatus.mockResolvedValue(null)
        const onError = vi.fn()
        const off = UploadOrchestrator.subscribe({ onError })

        UploadOrchestrator.startPolling('job-1', 'session-1')
        await vi.advanceTimersByTimeAsync(5000)

        expectHandedOver()
        expect(onError).not.toHaveBeenCalled()
        off()
      })

      test('keeps following a handed-over row by its document status, slowly, until it lands', async () => {
        mockDocumentsStore.updateTrackedFile.mockImplementation((id: string, patch: Partial<TrackedFile>) => {
          mockDocumentsStore.trackedFiles = mockDocumentsStore.trackedFiles.map((file) =>
            file.id === id ? { ...file, ...patch } : file
          )
        })
        mockClient.getJobStatus.mockResolvedValue(null)
        let status = 'processing'
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'doc-1', status }), { status: 200 }))
        vi.stubGlobal('fetch', fetchMock)
        const onComplete = vi.fn()
        const off = UploadOrchestrator.subscribe({ onComplete })
        const changed = vi.fn()
        const offChanged = onDocumentsChanged(changed)
        try {
          UploadOrchestrator.startPolling('job-1', 'session-1')
          await vi.advanceTimersByTimeAsync(5000)
          expect(fetchMock).not.toHaveBeenCalled()

          await vi.advanceTimersByTimeAsync(60_000)
          expect(fetchMock).toHaveBeenCalledTimes(1)
          expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc-1/status', expect.anything())
          expect(mockDocumentsStore.trackedFiles.find((f) => f.id === 'row-1')?.status).toBe('ingesting')
          expect(onComplete).not.toHaveBeenCalled()

          status = 'completed'
          await vi.advanceTimersByTimeAsync(60_000)
          expect(mockDocumentsStore.trackedFiles.find((f) => f.id === 'row-1')).toMatchObject({
            status: 'success',
            progress: 100,
          })
          expect(onComplete).toHaveBeenCalledTimes(1)
          expect(changed).toHaveBeenCalled()

          await vi.advanceTimersByTimeAsync(180_000)
          expect(fetchMock).toHaveBeenCalledTimes(2)
        } finally {
          off()
          offChanged()
          vi.unstubAllGlobals()
          mockDocumentsStore.updateTrackedFile.mockReset()
        }
      })

      test('the next queued job is still polled', async () => {
        mockClient.getJobStatus.mockResolvedValue(null)

        UploadOrchestrator.enqueueJobs([
          { jobId: 'job-1', collectionName: 'session-1', files: [] },
          { jobId: 'job-2', collectionName: 'session-1', files: [] },
        ])
        await vi.advanceTimersByTimeAsync(5000)

        expect(mockClient.getJobStatus).toHaveBeenCalledWith('job-2', expect.any(AbortSignal))
      })
    })

    describe('a hint that something settled', () => {
      const reading = { job_id: 'job-1', status: 'processing', file_details: [] }
      const done = {
        job_id: 'job-1',
        status: 'completed',
        file_details: [{ file_id: 'file-1', file_name: 'test.pdf', status: 'completed', progress_percent: 100 }],
      }

      test('asks about the job at once, one read per hint', async () => {
        mockClient.getJobStatus.mockResolvedValue(reading)
        mockClient.listFiles.mockResolvedValue([])
        const onComplete = vi.fn()
        const off = UploadOrchestrator.subscribe({ onComplete })

        UploadOrchestrator.startPolling('job-1', 'session-1')
        await vi.advanceTimersByTimeAsync(0)
        expect(mockClient.getJobStatus).toHaveBeenCalledTimes(1)

        mockClient.getJobStatus.mockResolvedValue(done)
        UploadOrchestrator.askNow()
        await vi.advanceTimersByTimeAsync(0)

        expect(mockClient.getJobStatus).toHaveBeenCalledTimes(2)
        expect(onComplete).toHaveBeenCalledTimes(1)
        off()
      })

      test('without a hint the job is asked about once a minute, and never handed over for taking long', async () => {
        mockClient.getJobStatus.mockResolvedValue(reading)

        UploadOrchestrator.startPolling('job-1', 'session-1')
        await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS - 1)
        expect(mockClient.getJobStatus).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(mockClient.getJobStatus).toHaveBeenCalledTimes(2)

        await vi.advanceTimersByTimeAsync(33 * FALLBACK_POLL_MS)
        expect(mockToast.info).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(27 * FALLBACK_POLL_MS)
        expect(mockClient.getJobStatus).toHaveBeenCalledTimes(62)
        expect(mockDocumentsStore.updateTrackedFile).not.toHaveBeenCalled()
        expect(mockToast.info).toHaveBeenCalledTimes(1)
        expect(mockToast.info).toHaveBeenCalledWith(STILL_READING, expect.anything())
        expect(mockDocumentsStore.setError).not.toHaveBeenCalled()
      })

      test('status reads that keep failing are asked again at the floor, not failed', async () => {
        mockClient.getJobStatus.mockRejectedValue(new Error('Network error'))

        UploadOrchestrator.startPolling('job-1', 'session-1')
        await vi.advanceTimersByTimeAsync(3 * FALLBACK_POLL_MS)

        expect(mockClient.getJobStatus).toHaveBeenCalledTimes(4)
        expect(mockDocumentsStore.setError).not.toHaveBeenCalled()
      })

      test('a hint during a read in flight asks once more, since that read may predate the settle', async () => {
        let answer: (value: typeof reading) => void = () => undefined
        mockClient.getJobStatus.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
        mockClient.getJobStatus.mockResolvedValue(done)
        mockClient.listFiles.mockResolvedValue([])

        UploadOrchestrator.startPolling('job-1', 'session-1')
        UploadOrchestrator.askNow()
        UploadOrchestrator.askNow()
        expect(mockClient.getJobStatus).toHaveBeenCalledTimes(1)

        answer(reading)
        await vi.advanceTimersByTimeAsync(0)
        expect(mockClient.getJobStatus).toHaveBeenCalledTimes(2)
        expect(mockDocumentsStore.setPolling).toHaveBeenLastCalledWith(false)
      })

      test('with nothing followed a hint asks nothing', async () => {
        UploadOrchestrator.askNow()
        await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS)
        expect(mockClient.getJobStatus).not.toHaveBeenCalled()
      })

      test('asks about a watched row at once', async () => {
        mockDocumentsStore.trackedFiles = [
          { id: 'row-1', fileName: 'haus.ifc', fileSize: 1, status: 'ingesting', progress: 0, serverFileId: 'doc-1', collectionName: 'session-1' },
        ]
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'doc-1', status: 'completed' }), { status: 200 }))
        vi.stubGlobal('fetch', fetchMock)
        const onComplete = vi.fn()
        const off = UploadOrchestrator.subscribe({ onComplete })
        try {
          UploadOrchestrator.watchDocuments(['row-1'])
          await vi.advanceTimersByTimeAsync(1000)
          expect(fetchMock).not.toHaveBeenCalled()

          UploadOrchestrator.askNow()
          await vi.advanceTimersByTimeAsync(0)
          expect(fetchMock).toHaveBeenCalledTimes(1)
          expect(mockDocumentsStore.updateTrackedFile).toHaveBeenCalledWith('row-1', expect.objectContaining({ status: 'success' }))
          expect(onComplete).toHaveBeenCalledTimes(1)
        } finally {
          off()
          vi.unstubAllGlobals()
        }
      })
    })

    test('handles polling errors', async () => {
      mockClient.getJobStatus.mockRejectedValue(new Error('Network error'))

      UploadOrchestrator.startPolling('job-1', 'session-1')

      await vi.advanceTimersByTimeAsync(5000)
    })

    test('handles abort errors silently', async () => {
      const abortError = new Error('Aborted')
      abortError.name = 'AbortError'
      mockClient.getJobStatus.mockRejectedValue(abortError)

      UploadOrchestrator.startPolling('job-1', 'session-1')
      await vi.advanceTimersByTimeAsync(5000)

      expect(mockDocumentsStore.setError).not.toHaveBeenCalled()
    })
  })

  describe('the session shelf', () => {
    const CHAT = 's_11111111_2222_4333_8444_555555555555'
    const row = (status: 'ingesting' | 'success') => ({
      file_id: 'doc-1',
      file_name: 'plan.pdf',
      collection_name: CHAT,
      status,
      chunk_count: 0,
      metadata: {},
    })

    test('lists a chat through the session documents route, not the proxy', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockListSessionDocuments.mockResolvedValue([row('success')])

      await UploadOrchestrator.handleSessionChange(CHAT, 'session')

      expect(mockListSessionDocuments).toHaveBeenCalledWith(CHAT)
      expect(mockClient.getCollection).not.toHaveBeenCalled()
      expect(mockClient.listFiles).not.toHaveBeenCalled()
      expect(mockDocumentsStore.setFilesFromServer).toHaveBeenCalledWith(CHAT, [row('success')])
    })

    test('does not resume a proxy job persisted for a chat', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockGetPersistedJobForCollection.mockReturnValue({
        jobId: 'job-legacy',
        collectionName: CHAT,
        files: [],
        timestamp: Date.now(),
      } as never)
      mockListSessionDocuments.mockResolvedValue([])

      await UploadOrchestrator.handleSessionChange(CHAT, 'session')

      expect(mockClient.getJobStatus).not.toHaveBeenCalled()
      expect(mockListSessionDocuments).toHaveBeenCalledWith(CHAT)
    })

    test('forgets the marker when the conversation is not on the server', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockListSessionDocuments.mockResolvedValue(null)

      await UploadOrchestrator.handleSessionChange(CHAT, 'session')

      expect(mockUnmarkSessionCollection).toHaveBeenCalledWith(CHAT)
    })

    test('polls by re-listing until nothing is in flight', async () => {
      mockListSessionDocuments
        .mockResolvedValueOnce([row('ingesting')])
        .mockResolvedValueOnce([row('success')])
      await UploadOrchestrator.handleSessionChange(CHAT, 'session')

      UploadOrchestrator.pollSessionDocuments(CHAT)
      expect(mockDocumentsStore.setPolling).toHaveBeenLastCalledWith(true)

      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(5000)

      expect(mockListSessionDocuments).toHaveBeenCalledTimes(2)
      expect(mockListSessionDocuments).toHaveBeenCalledWith(CHAT, expect.any(AbortSignal))
      expect(mockDocumentsStore.setFilesFromServer).toHaveBeenLastCalledWith(CHAT, [row('success')])
      expect(mockDocumentsStore.setPolling).toHaveBeenLastCalledWith(false)
      expect(mockClient.getJobStatus).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(5000)
      expect(mockListSessionDocuments).toHaveBeenCalledTimes(2)
    })

    test('a chat whose attachments finish reading tells the document listings once', async () => {
      const changed = vi.fn()
      const off = onDocumentsChanged(changed)
      mockListSessionDocuments
        .mockResolvedValueOnce([row('ingesting')])
        .mockResolvedValueOnce([row('success')])
      await UploadOrchestrator.handleSessionChange(CHAT, 'session')

      UploadOrchestrator.pollSessionDocuments(CHAT)
      await vi.advanceTimersByTimeAsync(5000)
      expect(changed).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(5000)

      expect(changed).toHaveBeenCalledTimes(1)
      off()
    })

    test('a reload with an attachment still being read resumes polling on its own', async () => {
      mockSessionHasKnownCollection.mockReturnValue(true)
      mockListSessionDocuments
        .mockResolvedValueOnce([row('ingesting')])
        .mockResolvedValueOnce([row('success')])

      await UploadOrchestrator.handleSessionChange(CHAT, 'session')
      await vi.advanceTimersByTimeAsync(5000)

      expect(mockListSessionDocuments).toHaveBeenCalledTimes(2)
      expect(mockDocumentsStore.setFilesFromServer).toHaveBeenLastCalledWith(CHAT, [row('success')])
    })

    test('past the poll budget it keeps re-listing, slower, and says so once', async () => {
      mockListSessionDocuments.mockResolvedValue([row('ingesting')])
      await UploadOrchestrator.handleSessionChange(CHAT, 'session')
      mockListSessionDocuments.mockClear()
      UploadOrchestrator.pollSessionDocuments(CHAT)

      await vi.advanceTimersByTimeAsync(420 * 5000)
      expect(mockListSessionDocuments).toHaveBeenCalledTimes(420)
      expect(mockToast.info).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(5000)
      expect(mockToast.info).toHaveBeenCalledTimes(1)
      expect(mockToast.info).toHaveBeenCalledWith(STILL_READING, expect.anything())
      expect(mockDocumentsStore.setError).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(60_000)
      expect(mockListSessionDocuments).toHaveBeenCalledTimes(422)
      expect(mockToast.info).toHaveBeenCalledTimes(1)

      mockListSessionDocuments.mockResolvedValue([row('success')])
      await vi.advanceTimersByTimeAsync(60_000)
      expect(mockDocumentsStore.setPolling).toHaveBeenLastCalledWith(false)
    })

    test('switching chats stops the poll', async () => {
      mockListSessionDocuments.mockResolvedValue([row('ingesting')])
      await UploadOrchestrator.handleSessionChange(CHAT, 'session')
      UploadOrchestrator.pollSessionDocuments(CHAT)

      await UploadOrchestrator.handleSessionChange('s_other', 'session')
      await vi.advanceTimersByTimeAsync(10000)

      expect(mockListSessionDocuments).not.toHaveBeenCalledWith(CHAT, expect.any(AbortSignal))
    })
  })
})
