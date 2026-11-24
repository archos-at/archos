import type { NameMatch } from '@/lib/upload-screening/name-screen'
import { xhrUpload, XhrUploadError } from '@/lib/http/xhr-upload'
import { fileExtensionLabel } from '../document-kind'
import type { DocumentsActions, TrackedFile } from '../types'
import { mapUploadResponseStatus } from '../utils'
import { shouldEmitProgress } from './upload-progress'
import { sendWaitingOutRateLimit } from './upload-queue'
import { mayRetryRefusal, uploadRefusalOf } from './upload-refusal'
import { UploadFailureSentence, uploadFailureSentence, type UploadFailureCopy } from './upload-failure'

interface UploadDocumentResponse {
  documentId?: string
  jobId?: string | null
  status?: string
  unchanged?: boolean
}

interface UploadEntry {
  file: File
  tracked: TrackedFile
}

export interface UploadOutcome {
  unchangedCount: number
  uploadedTypes: string[]
  serverStopped: Array<{ file: File; matches: NameMatch[] }>
  heldReplaced: string[]
}

export interface UploadTrackedFileContext
  extends Pick<
    DocumentsActions,
    'updateTrackedFile' | 'setUploadProgress' | 'removeRecentlyDeletedIds' | 'dismissTrackedFiles'
  > {
  shelf: 'project' | 'office_shelf' | 'session'
  uploadUrl: string
  targetCollection: string
  projectId: string | undefined
  conversationProjectId: string | null | undefined
  batchId: string | null
  resolvedFolderId: (file: File) => string | null
  revisionOfFile: (file: File) => string | null
  asNorm?: boolean
  screeningReleased: (file: File) => boolean | undefined
  abortControllers: Map<string, AbortController>
  failureCopy: UploadFailureCopy
  outcome: UploadOutcome
}

export const isAbort = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError'

export async function uploadTrackedFile(
  { file, tracked }: UploadEntry,
  {
    shelf,
    uploadUrl,
    targetCollection,
    projectId,
    conversationProjectId,
    batchId,
    resolvedFolderId,
    revisionOfFile,
    asNorm = false,
    screeningReleased,
    abortControllers,
    failureCopy,
    outcome,
    updateTrackedFile,
    setUploadProgress,
    removeRecentlyDeletedIds,
    dismissTrackedFiles,
  }: UploadTrackedFileContext
): Promise<void> {
  const controller = new AbortController()
  abortControllers.set(tracked.id, controller)
  updateTrackedFile(tracked.id, { uploadStartedAt: Date.now() })

  const formData = new FormData()
  if (shelf === 'session') {
    formData.append('conversationId', targetCollection)
    if (conversationProjectId) formData.append('projectId', conversationProjectId)
  }
  if (projectId) formData.append('projectId', projectId)
  if (shelf === 'office_shelf') formData.append('scope', 'office_shelf')
  if (shelf === 'office_shelf' && asNorm) formData.append('asNorm', 'true')
  if (shelf !== 'session') {
    const resolved = resolvedFolderId(file)
    if (resolved) formData.append('folderId', resolved)
  }
  formData.append('file', file)
  if (screeningReleased(file)) formData.append('screeningRelease', 'name')
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
    if (result.unchanged) outcome.unchangedCount += 1
    if (result.documentId) removeRecentlyDeletedIds([result.documentId])
    updateTrackedFile(tracked.id, {
      status: mapUploadResponseStatus(result.status, result.unchanged === true),
      serverFileId: result.documentId,
      jobId: result.jobId ?? undefined,
      ...(result.unchanged ? { unchanged: true } : {}),
      bytesUploaded: file.size,
    })
    outcome.uploadedTypes.push(fileExtensionLabel(file.name).toLowerCase() || 'unknown')
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
      outcome.heldReplaced.push(sentence)
      return
    }
    if (refusal?.kind === 'name-stop') {
      dismissTrackedFiles([tracked.id])
      outcome.serverStopped.push({ file, matches: refusal.matches })
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
    abortControllers.delete(tracked.id)
  }
}
