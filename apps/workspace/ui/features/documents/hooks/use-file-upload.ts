'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { createDocumentsClient } from '@/adapters/api'
import { deleteSessionDocument } from '@/adapters/api/session-documents-client'
import { xhrUpload, XhrUploadError } from '@/lib/http/xhr-upload'
import { formatBytes } from '@/lib/format'
import { useDocumentsStore } from '../store'
import { useAuth } from '@/adapters/auth'
import { useAppConfig } from '@/shared/context'
import { mayRetryUpload, type TrackedFile, type UploadIntent } from '../types'
import { mapUploadResponseStatus } from '../utils'
import { shouldEmitProgress } from '../lib/upload-progress'
import { isJoblessIngesting, trackedPatchFromStatus } from '../lib/document-status-reads'
import { runWithConcurrency, sendWaitingOutRateLimit, UPLOAD_CONCURRENCY } from '../lib/upload-queue'
import { validateFileUpload, type ValidationContext } from '../validation'
import { summarizeValidation } from '../lib/validation-messages'
import { UploadOrchestrator } from '../orchestrator'
import { useUploadOrchestrator } from './use-upload-orchestrator'
import type { PendingJob } from '../orchestrator'
import { markSessionHasCollection } from '../persistence'
import { notifyDocumentsChanged } from '@/lib/documents/document-changes'
import { loadUploadScreeningPolicy } from '@/adapters/api/upload-screening-policy'
import type { NameMatch } from '@/lib/upload-screening/name-screen'
import { screenFileNames, uploadAnywayOffer } from '../lib/name-screened-files'
import { describeScreenedOut } from '@/lib/upload-screening/quarantine'
import type { UploadScreeningPolicy } from '@/lib/upload-screening/policy'
import { exclusionsByTerm, openUploadBatch, sealUploadBatch } from '../lib/upload-batch'
import { captureUploadBatch } from './upload-batch-event'
import { fileExtensionLabel } from '../document-kind'
import { failedWhileReading } from '../lib/ingest-failure'
import { requestReingest } from '../lib/reingest-request'
import { stopReadingRow } from '../lib/stop-reading'
import { mayRetryRefusal, uploadRefusalOf } from '../lib/upload-refusal'
import { uploadFailureSentence, UploadFailureSentence, type UploadFailureCopy } from '../lib/upload-failure'
import { toast } from 'sonner'

interface UploadDocumentResponse {
  documentId?: string
  jobId?: string | null
  status?: string
  unchanged?: boolean
}

const DELETE_ROUTE: Record<'project' | 'office_shelf', (id: string) => string> = {
  project: (id) => `/api/documents/${encodeURIComponent(id)}`,
  office_shelf: (id) => `/api/documents/${encodeURIComponent(id)}`,
}

async function deleteShelfDocument(shelf: 'project' | 'office_shelf' | 'session', documentId: string): Promise<void> {
  if (shelf === 'session') return deleteSessionDocument(documentId)
  const response = await fetch(DELETE_ROUTE[shelf](documentId), { method: 'DELETE' })
  if (response.ok || response.status === 404) return
  const body: unknown = await response.json().catch(() => null)
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message
  throw new Error(typeof message === 'string' && message ? message : `Delete failed: ${response.status}`)
}

const isAbort = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError'

interface UseFileUploadOptions {
  collectionName?: string
  projectId?: string
  folderId?: string
  officeShelf?: boolean
  conversationProjectId?: string | null
  onComplete?: () => void
  onError?: (error: Error) => void
}

export interface UploadFilesOptions {
  collectionOverride?: string
  folderIdFor?: (file: File) => string | null | undefined
  folderPathFor?: (file: File) => string | null | undefined
  screeningReleased?: (file: File) => boolean
  revisionOf?: (file: File) => string | null | undefined
  excludedByScreening?: ReadonlyArray<readonly NameMatch[]>
  screeningPolicy?: UploadScreeningPolicy
}

interface UseFileUploadReturn {
  uploadFiles: (files: File[], options?: UploadFilesOptions) => Promise<number>
  cancelUpload: () => void
  cancelFile: (fileId: string) => void
  dismissFiles: (fileIds: string[]) => void
  deleteFile: (fileId: string) => Promise<void>
  retryFile: (fileId: string) => Promise<void>
  trackedFiles: TrackedFile[]
  sessionFiles: TrackedFile[]
  validationContext: ValidationContext
  isUploading: boolean
  isPolling: boolean
  error: string | null
  clearError: () => void
}

export const useFileUpload = (options: UseFileUploadOptions = {}): UseFileUploadReturn => {
  const { collectionName, projectId, folderId, officeShelf, conversationProjectId, onComplete, onError } =
    options
  const shelf: 'project' | 'office_shelf' | 'session' = officeShelf ? 'office_shelf' : projectId ? 'project' : 'session'

  const { idToken } = useAuth()
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const failureCopy = useMemo<UploadFailureCopy>(
    () => ({
      projectClosed: t('errors.projectClosed'),
      failed: t('errors.uploadFailed'),
      network: t('errors.uploadNetwork'),
      stalled: t('errors.uploadStalled'),
      timeout: t('errors.uploadTimeout'),
      folderReadOnly: t('folders.access.readOnlyRefused'),
      changedMeanwhile: t('errors.uploadChangedMeanwhile'),
      screeningUnavailable: t('errors.screeningPolicyUnavailable'),
      storageFull: t('errors.uploadStorageFull'),
      nameTaken: (name) => t('errors.nameTaken', { name }),
      heldReplace: (name) => t('errors.quarantinedReplace', { name }),
      tooLarge: (name, limitBytes) =>
        limitBytes === null
          ? t('errors.uploadTooLarge', { name })
          : t('errors.uploadTooLargeLimit', { name, limit: formatBytes(limitBytes, locale) }),
      invalidType: (name, accepted) => t('errors.validation.invalidType', { name, accepted: accepted.join(', ') }),
    }),
    [t, locale]
  )
  const { fileUpload: fileUploadConfig } = useAppConfig()
  const clientRef = useRef(createDocumentsClient({ authToken: idToken }))
  const abortControllersRef = useRef(new Map<string, AbortController>())

  const trackedFiles = useDocumentsStore((s) => s.trackedFiles)
  const isUploading = useDocumentsStore((s) => s.isUploading)
  const isPolling = useDocumentsStore((s) => s.isPolling)
  const error = useDocumentsStore((s) => s.error)
  const setCurrentCollection = useDocumentsStore((s) => s.setCurrentCollection)
  const setCollectionInfo = useDocumentsStore((s) => s.setCollectionInfo)
  const addTrackedFile = useDocumentsStore((s) => s.addTrackedFile)
  const updateTrackedFile = useDocumentsStore((s) => s.updateTrackedFile)
  const setUploadProgress = useDocumentsStore((s) => s.setUploadProgress)
  const removeTrackedFile = useDocumentsStore((s) => s.removeTrackedFile)
  const dismissTrackedFiles = useDocumentsStore((s) => s.dismissTrackedFiles)
  const unmarkRecentlyDeleted = useDocumentsStore((s) => s.unmarkRecentlyDeleted)
  const removeRecentlyDeletedIds = useDocumentsStore((s) => s.removeRecentlyDeletedIds)
  const setUploading = useDocumentsStore((s) => s.setUploading)
  const setError = useDocumentsStore((s) => s.setError)
  const clearError = useDocumentsStore((s) => s.clearError)
  const setNameStopped = useDocumentsStore((s) => s.setNameStopped)

  const sessionFiles = useMemo(
    () => (collectionName ? trackedFiles.filter((f) => f.collectionName === collectionName) : []),
    [trackedFiles, collectionName]
  )

  const validationContext: ValidationContext = useMemo(
    () => ({
      existingTotalSize: sessionFiles.reduce((sum, f) => sum + f.fileSize, 0),
      existingFileCount: sessionFiles.length,
      existingFileNames: new Set(sessionFiles.map((f) => f.fileName)),
      durableCorpus: Boolean(projectId || officeShelf),
    }),
    [sessionFiles, projectId, officeShelf]
  )

  useEffect(() => {
    clientRef.current = createDocumentsClient({ authToken: idToken })
    UploadOrchestrator.setAuthToken(idToken)
  }, [idToken])

  useUploadOrchestrator({ collectionName, projectId, officeShelf, onComplete, onError })

  const ensureCollectionExists = useCallback(
    async (collectionName: string): Promise<void> => {
      if (shelf === 'session') {
        markSessionHasCollection(collectionName)
        setCurrentCollection(collectionName)
        return
      }
      let collection = await clientRef.current.getCollection(collectionName)

      if (!collection) {
        collection = await clientRef.current.createCollection(
          collectionName,
          `Documents for session ${collectionName}`
        )
      }

      markSessionHasCollection(collectionName)

      setCurrentCollection(collectionName)
      setCollectionInfo(collection)
    },
    [shelf, setCurrentCollection, setCollectionInfo]
  )

  const uploadFiles = useCallback(
    async (files: File[], options?: UploadFilesOptions): Promise<number> => {
      if (files.length === 0) return 0

      const targetCollection = options?.collectionOverride ?? collectionName
      if (!targetCollection) {
        const uploadError = new Error('Collection name required for upload')
        console.error('[upload]', uploadError.message)
        setError(failureCopy.failed)
        onError?.(uploadError)
        return 0
      }

      const validationResult = validateFileUpload(files, validationContext, fileUploadConfig, locale)

      const imageVlmBlocked = validationResult.fileErrors.some((e) => e.reason === 'image-vlm-unavailable')
      const imageVlmMessage = t('errors.imageVlmUnavailable')

      const localizedSummary = summarizeValidation(validationResult, t)

      if (validationResult.batchErrors.length > 0) {
        setError(localizedSummary)
        return 0
      }

      if (validationResult.validFiles.length === 0) {
        setError(imageVlmBlocked ? imageVlmMessage : localizedSummary)
        return 0
      }

      let policy: UploadScreeningPolicy
      try {
        policy = options?.screeningPolicy ?? (await loadUploadScreeningPolicy(shelf === 'project' ? projectId : null))
      } catch {
        setError(t('errors.screeningPolicyUnavailable'))
        return 0
      }
      const named = screenFileNames(validationResult.validFiles, policy, t, options)
      const validFiles = named.allowed
      const screenedMessage = named.message
      const offerAnyway = (stopped: File[]) => setNameStopped(uploadAnywayOffer(stopped, options, uploadFiles))
      offerAnyway(named.stopped.map(({ file }) => file))
      if (validFiles.length === 0) {
        setError(screenedMessage ?? localizedSummary)
        return 0
      }
      setUploading(true)

      if (screenedMessage) {
        setError(screenedMessage)
      } else if (validationResult.fileErrors.length > 0) {
        const skippedCount = validationResult.fileErrors.length
        const uploadingCount = validFiles.length
        setError(
          t('errors.uploadingSkipped', {
            uploading: uploadingCount,
            fileLabel: uploadingCount > 1 ? t('errors.filePlural') : t('errors.fileSingular'),
            skipped: skippedCount,
            summary: imageVlmBlocked ? imageVlmMessage : (localizedSummary ?? ''),
          })
        )
      } else {
        clearError()
      }

      const resolvedFolderId = (file: File): string | null => {
        const target = options?.folderIdFor ? options.folderIdFor(file) : folderId
        return (target === undefined ? folderId : target) ?? null
      }

      const revisionOfFile = (file: File): string | null => options?.revisionOf?.(file) ?? null

      const entries = validFiles.map((file) => ({
        file,
        tracked: {
          id: uuidv4(),
          file,
          fileName: file.name,
          fileSize: file.size,
          status: 'uploading',
          progress: 0,
          bytesUploaded: 0,
          collectionName: targetCollection,
          uploadedAt: new Date().toISOString(),
          uploadIntent: {
            folderId: resolvedFolderId(file),
            folderPath: options?.folderPathFor?.(file) ?? null,
            screeningReleased: options?.screeningReleased?.(file) === true,
            ...(revisionOfFile(file) ? { revisionOf: revisionOfFile(file) } : {}),
          },
        } satisfies TrackedFile as TrackedFile,
      }))

      for (const entry of entries) addTrackedFile(entry.tracked)

      let taken = 0
      try {
        await ensureCollectionExists(targetCollection)

        const batchId = await openUploadBatch({
          id: uuidv4(),
          scope: shelf,
          projectId: shelf === 'project' ? (projectId ?? null) : null,
          conversationId: shelf === 'session' ? targetCollection : null,
          expectedCount: entries.length,
          excluded: exclusionsByTerm([
            ...(options?.excludedByScreening ?? []),
            ...named.stopped.map(({ matches }) => matches),
          ]),
        })
        let unchangedCount = 0
        const uploadedTypes: string[] = []
        const serverStopped: Array<{ file: File; matches: NameMatch[] }> = []
        const heldReplaced: string[] = []

        const uploadUrl = shelf === 'session' ? '/api/session/documents/upload' : '/api/documents/upload'
        const results = await runWithConcurrency(entries, UPLOAD_CONCURRENCY, async ({ file, tracked }) => {
          const controller = new AbortController()
          abortControllersRef.current.set(tracked.id, controller)
          updateTrackedFile(tracked.id, { uploadStartedAt: Date.now() })

          const formData = new FormData()
          if (shelf === 'session') {
            formData.append('conversationId', targetCollection)
            if (conversationProjectId) formData.append('projectId', conversationProjectId)
          }
          if (projectId) formData.append('projectId', projectId)
          if (shelf === 'office_shelf') formData.append('scope', 'office_shelf')
          if (shelf !== 'session') {
            const resolved = resolvedFolderId(file)
            if (resolved) formData.append('folderId', resolved)
          }
          formData.append('file', file)
          if (options?.screeningReleased?.(file)) formData.append('screeningRelease', 'name')
          const revisionOf = shelf === 'session' ? null : revisionOfFile(file)
          if (revisionOf) formData.append('revisionOf', revisionOf)
          if (batchId) formData.append('uploadBatchId', batchId)
          if (file.webkitRelativePath) {
            formData.append('originPath', file.webkitRelativePath)
          }

          let lastEmitted = 0
          try {
            const responseText = await sendWaitingOutRateLimit(
              () =>
                xhrUpload({
                  url: uploadUrl,
                  body: formData,
                  signal: controller.signal,
                  onProgress: (loaded, total) => {
                    const bytes = total > 0 ? Math.min(file.size, Math.round((loaded / total) * file.size)) : 0
                    if (!shouldEmitProgress(lastEmitted, bytes, file.size)) return
                    lastEmitted = bytes
                    setUploadProgress(tracked.id, bytes)
                  },
                }),
              (error) => (error instanceof XhrUploadError && error.status === 429 ? error.retryAfterSeconds ?? 1 : null),
              controller.signal
            )

            const result = JSON.parse(responseText) as UploadDocumentResponse
            if (result.unchanged) unchangedCount += 1
            if (result.documentId) removeRecentlyDeletedIds([result.documentId])
            updateTrackedFile(tracked.id, {
              status: mapUploadResponseStatus(result.status, result.unchanged === true),
              serverFileId: result.documentId,
              jobId: result.jobId ?? undefined,
              ...(result.unchanged ? { unchanged: true } : {}),
              bytesUploaded: file.size,
            })
            uploadedTypes.push(fileExtensionLabel(file.name).toLowerCase() || 'unknown')
          } catch (err) {
            if (isAbort(err)) {
              updateTrackedFile(tracked.id, { status: 'canceled' })
              return
            }
            const refusal = uploadRefusalOf(err)
            if (refusal?.kind === 'held-replace') {
              const sentence = failureCopy.heldReplace(file.name)
              updateTrackedFile(tracked.id, {
                status: 'held',
                errorMessage: sentence,
                retryable: false,
                replacesHeld: { documentId: refusal.documentId, ownUpload: refusal.ownUpload },
              })
              heldReplaced.push(sentence)
              return
            }
            if (refusal?.kind === 'name-stop') {
              dismissTrackedFiles([tracked.id])
              serverStopped.push({ file, matches: refusal.matches })
              return
            }
            const message = uploadFailureSentence(err, failureCopy, file.name)
            updateTrackedFile(tracked.id, {
              status: 'failed',
              errorMessage: message,
              ...(mayRetryRefusal(refusal) ? {} : { retryable: false as const }),
            })
            console.warn('[upload] %s was not uploaded:', file.name, err)
            throw new UploadFailureSentence(message, { cause: err })
          } finally {
            abortControllersRef.current.delete(tracked.id)
          }
        })

        notifyDocumentsChanged()

        if (uploadedTypes.length > 0) {
          captureUploadBatch(uploadedTypes, shelf)
        }

        if (batchId) {
          const excluded = exclusionsByTerm(serverStopped.map(({ matches }) => matches))
          await sealUploadBatch(batchId, {
            unchanged: unchangedCount,
            failed: results.filter((result) => result.status === 'rejected').length,
            ...(excluded.length > 0 ? { excluded } : {}),
          })
        }

        taken = results.filter((result) => result.status === 'fulfilled').length
        const firstFailure = results.find((result) => result.status === 'rejected')
        if (firstFailure && firstFailure.status === 'rejected') {
          const failedCount = results.filter((result) => result.status === 'rejected').length
          const message = uploadFailureSentence(firstFailure.reason, failureCopy)
          setError(
            failedCount > 1
              ? t('errors.someUploadsFailed', { failed: failedCount, total: entries.length, reason: message })
              : message
          )
          onError?.(firstFailure.reason instanceof Error ? firstFailure.reason : new Error(message))
        } else if (serverStopped.length > 0) {
          setError(describeScreenedOut([...named.stopped, ...serverStopped], t) ?? failureCopy.failed)
          offerAnyway([...named.stopped, ...serverStopped].map(({ file }) => file))
        } else if (heldReplaced.length > 0 && !screenedMessage) {
          setError(heldReplaced[0])
        }
      } catch (err) {
        if (isAbort(err)) {
          for (const { tracked } of entries) {
            const storeFile = useDocumentsStore.getState().trackedFiles.find((f) => f.id === tracked.id)
            if (storeFile?.status === 'uploading') updateTrackedFile(tracked.id, { status: 'canceled' })
          }
          return taken
        }
        const message = uploadFailureSentence(err, failureCopy)
        setError(message)
        onError?.(err instanceof Error ? err : new Error(message))

        for (const { tracked } of entries) {
          const storeFile = useDocumentsStore.getState().trackedFiles.find((f) => f.id === tracked.id)
          if (!storeFile || storeFile.serverFileId || storeFile.jobId) continue
          if (storeFile.status !== 'uploading') continue
          updateTrackedFile(tracked.id, { status: 'failed', errorMessage: message })
        }
      } finally {
        const settled = entries.map(({ tracked }) =>
          useDocumentsStore.getState().trackedFiles.find((f) => f.id === tracked.id)
        )
        if (shelf === 'session') {
          if (settled.some((file) => file?.status === 'ingesting')) {
            UploadOrchestrator.pollSessionDocuments(targetCollection)
          }
        } else {
          const filesByJob = new Map<string, TrackedFile[]>()
          for (const storeFile of settled) {
            if (!storeFile?.jobId) continue
            const files = filesByJob.get(storeFile.jobId) || []
            files.push(storeFile)
            filesByJob.set(storeFile.jobId, files)
          }

          const pendingJobEntries: PendingJob[] = []
          for (const [jobId, files] of filesByJob) {
            pendingJobEntries.push({ jobId, collectionName: targetCollection, files })
          }
          if (pendingJobEntries.length > 0) {
            UploadOrchestrator.enqueueJobs(pendingJobEntries)
          }
          const detached = settled.filter((file): file is TrackedFile => !!file && isJoblessIngesting(file))
          if (detached.length > 0) UploadOrchestrator.watchDocuments(detached.map((file) => file.id))
        }
        setUploading(false)
      }
      return taken
    },
    [
      collectionName,
      projectId,
      folderId,
      shelf,
      conversationProjectId,
      validationContext,
      fileUploadConfig,
      locale,
      ensureCollectionExists,
      addTrackedFile,
      updateTrackedFile,
      dismissTrackedFiles,
      setUploadProgress,
      setUploading,
      clearError,
      setError,
      setNameStopped,
      onError,
      removeRecentlyDeletedIds,
      failureCopy,
      t,
    ]
  )

  const stopReading = useCallback(
    async (fileId: string, documentId: string): Promise<void> => {
      const outcome = await stopReadingRow(fileId, documentId)
      if (outcome === 'cancelled') {
        notifyDocumentsChanged()
        return
      }
      if (outcome === 'finished') {
        toast.info(t('actions.cancelFinished'))
        UploadOrchestrator.watchDocuments([fileId])
        return
      }
      if (outcome === 'unavailable') {
        toast.info(t('actions.cancelUnavailable'))
        return
      }
      toast.error(t('actions.cancelError'))
    },
    [t]
  )

  const cancelFile = useCallback(
    (fileId: string) => {
      const file = useDocumentsStore.getState().trackedFiles.find((f) => f.id === fileId)
      if (file?.status === 'ingesting' && file.serverFileId) {
        void stopReading(fileId, file.serverFileId)
        return
      }
      abortControllersRef.current.get(fileId)?.abort()
    },
    [stopReading]
  )

  const cancelUpload = useCallback(() => {
    for (const controller of abortControllersRef.current.values()) controller.abort()
    abortControllersRef.current.clear()
    UploadOrchestrator.stopPolling()
    setUploading(false)
  }, [setUploading])

  const dismissFiles = useCallback(
    (fileIds: string[]) => {
      dismissTrackedFiles(fileIds)
    },
    [dismissTrackedFiles]
  )

  const deleteFile = useCallback(
    async (fileId: string) => {
      const file = trackedFiles.find((f) => f.id === fileId)
      if (!file || !file.collectionName) {
        removeTrackedFile(fileId)
        return
      }

      const documentId = file.serverFileId
      if (!documentId) {
        removeTrackedFile(fileId)
        return
      }

      removeTrackedFile(fileId)

      try {
        await deleteShelfDocument(shelf, documentId)
      } catch (err) {
        addTrackedFile(file)
        unmarkRecentlyDeleted(file)
        const message = err instanceof Error ? err.message : 'Delete failed'
        setError(message)
      }
    },
    [shelf, trackedFiles, addTrackedFile, removeTrackedFile, unmarkRecentlyDeleted, setError]
  )

  const pendingRetriesRef = useRef<{ files: File[]; done: Promise<void> } | null>(null)
  const retryIntentsRef = useRef(new Map<File, UploadIntent>())
  const retryFile = useCallback(
    async (fileId: string) => {
      const file = trackedFiles.find((f) => f.id === fileId)
      if (!file || !mayRetryUpload(file)) return

      if (file.status === 'failed' && file.serverFileId && failedWhileReading(file) && shelf !== 'session') {
        const outcome = await requestReingest(file.serverFileId)
        if (outcome.kind === 'failed') {
          setError(t('actions.reingestError'))
          return
        }
        if (outcome.kind === 'unchanged') {
          updateTrackedFile(fileId, { retryable: false })
          toast.info(t('actions.reingestWouldFailAgain'))
          return
        }
        const settled = outcome.kind === 'settled' ? trackedPatchFromStatus(outcome.status) : null
        updateTrackedFile(fileId, settled ?? { status: 'ingesting', errorMessage: null, jobId: undefined, progress: 0 })
        UploadOrchestrator.watchDocuments([fileId])
        notifyDocumentsChanged()
        return
      }

      if (!file.file) {
        setError(t('errors.cannotRetryServerFile'))
        return
      }

      removeTrackedFile(fileId)
      if (file.uploadIntent) retryIntentsRef.current.set(file.file, file.uploadIntent)
      const pending = pendingRetriesRef.current
      if (pending) {
        pending.files.push(file.file)
        return pending.done
      }
      const files = [file.file]
      const done = Promise.resolve().then(async () => {
        pendingRetriesRef.current = null
        const intents = retryIntentsRef.current
        const intentOf = (each: File): UploadIntent | undefined => intents.get(each)
        const retryOptions: UploadFilesOptions = {
          folderIdFor: (each) => intentOf(each)?.folderId,
          folderPathFor: (each) => intentOf(each)?.folderPath,
          screeningReleased: (each) => intentOf(each)?.screeningReleased === true,
          revisionOf: (each) => intentOf(each)?.revisionOf,
        }
        try {
          if (shelf !== 'session') {
            await uploadFiles(files, retryOptions)
            return
          }
          for (const each of files) await uploadFiles([each], retryOptions)
        } finally {
          for (const each of files) intents.delete(each)
        }
      })
      pendingRetriesRef.current = { files, done }
      await done
    },
    [trackedFiles, removeTrackedFile, updateTrackedFile, uploadFiles, setError, t, shelf]
  )

  return {
    uploadFiles,
    cancelUpload,
    cancelFile,
    dismissFiles,
    deleteFile,
    retryFile,
    trackedFiles,
    sessionFiles,
    validationContext,
    isUploading,
    isPolling,
    error,
    clearError,
  }
}
