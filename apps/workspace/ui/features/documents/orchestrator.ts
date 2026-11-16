import { toast } from 'sonner'
import { createDocumentsClient } from '@/adapters/api'
import { getStoreTranslator } from '@/i18n/store-translator'
import { filesCopy } from '@/i18n/namespaces/files'
import { listSessionDocuments } from '@/adapters/api/session-documents-client'
import { useDocumentsStore } from './store'
import { useLayoutStore } from '@/features/layout/store'
import type { TrackedFile } from './types'
import { isEndedJobStatus, trackedStatusOfJobFile } from './utils'
import { classifyIngestFailure, ingestFailureSentence } from './lib/ingest-failure'
import { notifyDocumentsChanged } from '@/lib/documents/document-changes'
import { createDocumentWatch } from './lib/document-watch'
import {
  persistJob,
  removePersistedJob,
  getPersistedJobForCollection,
  updatePersistedJobFiles,
  sessionHasKnownCollection,
  markSessionHasCollection,
  unmarkSessionCollection,
  removePersistedJobForCollection,
} from './persistence'

const SESSION_POLL_INTERVAL_MS = 5000
const MAX_SESSION_POLL_ATTEMPTS = 420
export const FALLBACK_POLL_MS = 60_000
const STILL_READING_AFTER_MS = 35 * 60_000
const STILL_READING_TOAST_ID = 'upload-still-reading'

interface PollingState {
  jobId: string
  collectionName: string
  timeoutId: NodeJS.Timeout | null
  askAgain: boolean
  since: number
  abortController: AbortController
}

export type OrchestratorShelf = 'session' | 'corpus'

interface SessionPollState {
  conversationId: string
  timeoutId: NodeJS.Timeout | null
  pollCount: number
  abortController: AbortController
}

export interface PendingJob {
  jobId: string
  collectionName: string
  files: TrackedFile[]
}

export interface OrchestratorCallbacks {
  onComplete?: () => void
  onError?: (error: Error) => void
}

class UploadOrchestratorImpl {
  private pollingState: PollingState | null = null
  private sessionPoll: SessionPollState | null = null
  private currentShelf: OrchestratorShelf = 'corpus'
  private jobQueue: PendingJob[] = []
  private currentSessionId: string | null = null
  private lastLoadedSessionId: string | null = null
  private authToken: string | undefined = undefined
  private subscribers = new Set<OrchestratorCallbacks>()
  private documentWatch = createDocumentWatch({
    intervalMs: FALLBACK_POLL_MS,
    onSettled: () => {
      notifyDocumentsChanged()
      this.emit('onComplete')
    },
  })

  setAuthToken(token: string | undefined): void {
    this.authToken = token
  }

  subscribe(callbacks: OrchestratorCallbacks): () => void {
    this.subscribers.add(callbacks)
    return () => {
      this.subscribers.delete(callbacks)
    }
  }

  private emit(event: 'onComplete'): void
  private emit(event: 'onError', error: Error): void
  private emit(event: 'onComplete' | 'onError', error?: Error): void {
    for (const subscriber of [...this.subscribers]) {
      try {
        if (event === 'onComplete') subscriber.onComplete?.()
        else if (error) subscriber.onError?.(error)
      } catch (err) {
        console.warn('[UploadOrchestrator] a subscriber threw', err)
      }
    }
  }

  private getClient() {
    return createDocumentsClient({ authToken: this.authToken })
  }

  private getStore() {
    return useDocumentsStore.getState()
  }

  enqueueJobs(jobs: PendingJob[]): void {
    this.jobQueue.push(...jobs)
    if (!this.pollingState && this.jobQueue.length > 0) {
      this.dequeueAndPoll()
    }
  }

  private dequeueAndPoll(): void {
    const next = this.jobQueue.shift()
    if (next) {
      this.startPolling(next.jobId, next.collectionName, next.files)
    }
  }

  async handleSessionChange(
    newSessionId: string | undefined,
    shelf: OrchestratorShelf = 'corpus'
  ): Promise<void> {
    const previousSessionId = this.currentSessionId

    if (newSessionId === previousSessionId) {
      return
    }
    this.currentShelf = shelf

    this.stopPolling()
    this.stopSessionPolling()
    this.jobQueue = []

    this.getStore().clearError()

    if (previousSessionId) {
      this.getStore().clearFilesForCollection(previousSessionId)
    }

    this.currentSessionId = newSessionId ?? null
    this.lastLoadedSessionId = null

    if (newSessionId && sessionHasKnownCollection(newSessionId)) {
      this.getStore().setLoadingFiles(true)
    }

    if (newSessionId && shelf === 'session') {
      removePersistedJobForCollection(newSessionId)
    }

    if (newSessionId && shelf !== 'session') {
      const persistedJob = getPersistedJobForCollection(newSessionId)
      if (persistedJob) {
        if (this.currentSessionId === newSessionId) {
          await this.resumeFromPersistence(newSessionId, persistedJob.jobId)
        }
        return
      }
    }

    if (newSessionId && this.currentSessionId === newSessionId) {
      await this.loadFilesForSession(newSessionId)
    }
  }

  async loadFilesForSession(sessionId: string): Promise<void> {
    const store = this.getStore()

    const { knowledgeLayerAvailable } = useLayoutStore.getState()
    if (!knowledgeLayerAvailable) {
      store.setLoadingFiles(false)
      return
    }

    if (sessionId === this.lastLoadedSessionId) {
      store.setLoadingFiles(false)
      return
    }

    if (store.isUploading || store.isPolling) {
      store.setLoadingFiles(false)
      return
    }

    if (sessionId !== this.currentSessionId) {
      store.setLoadingFiles(false)
      return
    }

    const hasKnownCollection = sessionHasKnownCollection(sessionId)
    const hasPersistedJob = getPersistedJobForCollection(sessionId) !== null
    if (!hasKnownCollection && !hasPersistedJob) {
      this.lastLoadedSessionId = sessionId
      store.setLoadingFiles(false)
      return
    }

    if (this.currentShelf === 'session') {
      await this.loadSessionDocuments(sessionId)
      return
    }

    const client = this.getClient()

    store.setLoadingFiles(true)
    try {
      const collection = await client.getCollection(sessionId)

      if (sessionId !== this.currentSessionId) {
        return
      }

      if (collection) {
        const files = await client.listFiles(sessionId)

        if (sessionId !== this.currentSessionId) {
          return
        }

        store.setFilesFromServer(sessionId, files)
        store.setCurrentCollection(sessionId)
        store.setCollectionInfo(collection)

        markSessionHasCollection(sessionId)
      } else {
        unmarkSessionCollection(sessionId)
      }

      this.lastLoadedSessionId = sessionId
    } catch (_error) {
      this.lastLoadedSessionId = sessionId
    } finally {
      store.setLoadingFiles(false)
    }
  }

  private async loadSessionDocuments(conversationId: string): Promise<void> {
    const store = this.getStore()
    store.setLoadingFiles(true)
    try {
      const files = await listSessionDocuments(conversationId)
      if (conversationId !== this.currentSessionId) return

      if (files === null) {
        unmarkSessionCollection(conversationId)
      } else {
        store.setFilesFromServer(conversationId, files)
        store.setCurrentCollection(conversationId)
        markSessionHasCollection(conversationId)
        if (files.some((file) => file.status === 'ingesting'))
          this.pollSessionDocuments(conversationId)
      }
      this.lastLoadedSessionId = conversationId
    } catch {
      this.lastLoadedSessionId = conversationId
    } finally {
      store.setLoadingFiles(false)
    }
  }

  pollSessionDocuments(conversationId: string): void {
    if (this.sessionPoll?.conversationId === conversationId) return
    this.stopSessionPolling()
    this.sessionPoll = {
      conversationId,
      timeoutId: null,
      pollCount: 0,
      abortController: new AbortController(),
    }
    this.getStore().setPolling(true)
    this.scheduleSessionPoll()
  }

  private stopSessionPolling(): void {
    if (!this.sessionPoll) return
    if (this.sessionPoll.timeoutId) clearTimeout(this.sessionPoll.timeoutId)
    this.sessionPoll.abortController.abort()
    this.sessionPoll = null
    this.getStore().setPolling(this.pollingState !== null)
  }

  private scheduleSessionPoll(): void {
    const poll = this.sessionPoll
    if (!poll) return
    const interval = poll.pollCount > MAX_SESSION_POLL_ATTEMPTS ? FALLBACK_POLL_MS : SESSION_POLL_INTERVAL_MS
    poll.timeoutId = setTimeout(() => {
      void this.runSessionPoll(poll)
    }, interval)
  }

  private async runSessionPoll(poll: SessionPollState): Promise<void> {
    if (this.sessionPoll !== poll) return
    const store = this.getStore()

    if (poll.pollCount === MAX_SESSION_POLL_ATTEMPTS) this.announceStillReading()
    poll.pollCount++

    try {
      const files = await listSessionDocuments(poll.conversationId, poll.abortController.signal)
      if (this.sessionPoll !== poll) return
      if (files === null) {
        this.stopSessionPolling()
        return
      }
      store.setFilesFromServer(poll.conversationId, files)
      if (!files.some((file) => file.status === 'ingesting')) {
        this.stopSessionPolling()
        notifyDocumentsChanged()
        this.emit('onComplete')
        return
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('[UploadOrchestrator] Session poll error:', err)
    }
    this.scheduleSessionPoll()
  }

  private async resumeFromPersistence(sessionId: string, jobId: string): Promise<void> {
    const store = this.getStore()
    const client = this.getClient()
    const persistedJob = getPersistedJobForCollection(sessionId)

    if (!persistedJob) return

    try {
      const [serverFiles, jobStatus] = await Promise.all([
        client.listFiles(sessionId).catch(() => []),
        client.getJobStatus(jobId).catch(() => null),
      ])

      if (serverFiles.length > 0) {
        store.setFilesFromServer(sessionId, serverFiles)
      }

      if (jobStatus && !isEndedJobStatus(jobStatus.status)) {
        const serverFileNames = new Set(serverFiles.map((f) => f.file_name))
        for (const jobFile of jobStatus.file_details) {
          if (!serverFileNames.has(jobFile.file_name)) {
            const persistedFile = persistedJob.files.find((f) => f.fileName === jobFile.file_name)
            if (persistedFile) {
              store.addTrackedFile({
                ...persistedFile,
                status: trackedStatusOfJobFile(jobFile),
                progress: jobFile.progress_percent,
                errorMessage: jobFile.error_message ?? undefined,
                quarantine: jobFile.quarantine ?? null,
                serverFileId: jobFile.file_id,
              } as TrackedFile)
            }
          }
        }
      }

      if (serverFiles.length === 0 && (!jobStatus || jobStatus.file_details.length === 0)) {
        for (const file of persistedJob.files) {
          store.addTrackedFile(file as TrackedFile)
        }
      }
    } catch {
      for (const file of persistedJob.files) {
        store.addTrackedFile(file as TrackedFile)
      }
    }

    this.startPolling(jobId, sessionId)
  }

  startPolling(jobId: string, collectionName: string, filesToPersist?: TrackedFile[]): void {
    this.stopPolling()

    const store = this.getStore()
    store.setPolling(true)
    store.setActiveJobId(jobId)

    if (filesToPersist && filesToPersist.length > 0) {
      persistJob(jobId, collectionName, filesToPersist)
    }

    const abortController = new AbortController()

    this.pollingState = {
      jobId,
      collectionName,
      timeoutId: null,
      askAgain: false,
      since: Date.now(),
      abortController,
    }

    this.pollJobStatus()
  }

  askNow(): void {
    const job = this.pollingState
    if (job?.timeoutId) {
      clearTimeout(job.timeoutId)
      job.timeoutId = null
      void this.pollJobStatus()
    } else if (job) job.askAgain = true
    this.documentWatch.askNow()
  }

  stopPolling(): void {
    if (this.pollingState) {
      if (this.pollingState.timeoutId) {
        clearTimeout(this.pollingState.timeoutId)
      }
      this.pollingState.abortController.abort()
      this.pollingState = null
    }

    const store = this.getStore()
    store.setPolling(this.sessionPoll !== null)
    store.setActiveJobId(null)
  }

  stopPollingIfCollection(collectionName: string): void {
    if (this.pollingState?.collectionName === collectionName) {
      this.stopPolling()
    }
    if (this.sessionPoll?.conversationId === collectionName) {
      this.stopSessionPolling()
    }
  }

  private async pollJobStatus(): Promise<void> {
    if (!this.pollingState) return

    const { jobId, collectionName, abortController } = this.pollingState
    const store = this.getStore()
    const client = this.getClient()

    if (abortController.signal.aborted) {
      this.stopPolling()
      return
    }

    try {
      const status = await client.getJobStatus(jobId, abortController.signal)

      if (!status) {
        this.handOverToListing(jobId)
        return
      }

      store.updateFilesFromJobStatus(status)

      const currentFiles = this.getStore().trackedFiles.filter((f) => f.jobId === jobId)
      if (currentFiles.length > 0) {
        updatePersistedJobFiles(jobId, currentFiles)
      }

      const isTerminal = isEndedJobStatus(status.status)
      console.debug('[UploadOrchestrator] Job status:', status.status, 'isTerminal:', isTerminal)

      if (isTerminal) {
        this.stopPolling()
        removePersistedJob(jobId)

        notifyDocumentsChanged()

        if (status.status === 'completed') {
          this.emit('onComplete')
        } else if (status.status !== 'cancelled' && status.error_message) {
          const failure = classifyIngestFailure(status.error_message)
          store.setError(failure ? ingestFailureSentence(failure, getStoreTranslator(filesCopy)) : status.error_message)
          this.emit('onError', new Error(status.error_message))
        }

        if (this.jobQueue.length > 0) {
          this.dequeueAndPoll()
          return
        }

        this.lastLoadedSessionId = null
        this.loadFilesForSession(collectionName)
        return
      }

      this.scheduleNextPoll()
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        this.stopPolling()
        return
      }

      console.error('[UploadOrchestrator] Poll error:', err)

      if (!this.pollingState) return

      this.scheduleNextPoll()
    }
  }

  private handOverToListing(jobId: string): void {
    this.stopPolling()
    removePersistedJob(jobId)
    const store = this.getStore()
    const handedOver: string[] = []
    for (const file of store.trackedFiles) {
      if (file.jobId !== jobId) continue
      if (file.status !== 'uploading' && file.status !== 'ingesting') continue
      store.updateTrackedFile(file.id, { jobId: undefined, status: 'ingesting' })
      handedOver.push(file.id)
    }
    this.watchDocuments(handedOver)
    this.announceStillReading()
    if (this.jobQueue.length > 0) this.dequeueAndPoll()
  }

  watchDocuments(trackedIds: readonly string[]): void {
    this.documentWatch.watch(trackedIds)
  }

  private announceStillReading(): void {
    toast.info(getStoreTranslator(filesCopy)('uploads.stillReading'), { id: STILL_READING_TOAST_ID })
  }

  private scheduleNextPoll(): void {
    const job = this.pollingState
    if (!job) return
    if (job.since && Date.now() - job.since >= STILL_READING_AFTER_MS) {
      job.since = 0
      this.announceStillReading()
    }
    const wait = job.askAgain ? 0 : FALLBACK_POLL_MS
    job.askAgain = false
    job.timeoutId = setTimeout(() => {
      job.timeoutId = null
      if (this.pollingState === job) void this.pollJobStatus()
    }, wait)
  }

  async refreshFilesForSession(sessionId: string): Promise<void> {
    if (sessionId === this.currentSessionId) {
      this.lastLoadedSessionId = null
      await this.loadFilesForSession(sessionId)
    }
  }

  cleanup(): void {
    this.stopPolling()
    this.stopSessionPolling()
    this.documentWatch.stop()
    this.jobQueue = []
    this.currentSessionId = null
    this.lastLoadedSessionId = null
  }
}

export const UploadOrchestrator = new UploadOrchestratorImpl()
