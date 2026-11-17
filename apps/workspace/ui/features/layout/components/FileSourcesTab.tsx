'use client'

import { type FC, useCallback, useEffect, useRef, useState } from 'react'
import { UploadCloud, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { AnimatePresence } from '@/components/motion'
import { FileSourceCard, FileSourceCardSkeleton } from './FileSourceCard'
import { DeleteFileConfirmationModal } from './DeleteFileConfirmationModal'
import { useUploadDestination } from './UploadDestination'
import { FilePreviewDialog } from '@/features/documents/components/file-preview-dialog'
import { useFileUpload, FileUploadZone, UploadAnywayButton } from '@/features/documents'
import { useDocumentsStore } from '@/features/documents/store'
import { mapToDisplayStatus } from '@/features/documents/utils'
import { trackedFileToFileItem } from '@/features/documents/types'
import { failedWhileReading } from '@/features/documents/lib/ingest-failure'
import type { TrackedFile } from '@/features/documents/types'
import { sessionHasKnownCollection } from '@/features/documents/persistence'
import { useChatStore } from '@/features/chat/store'
import { getProjectCollection } from '@/adapters/api/projects-client'
import { useLayoutStore } from '../store'
import { useAppConfig } from '@/shared/context'
import { useTranslations } from '@/i18n'
import { researchCopy } from '@/i18n/namespaces/research'
import { quarantineVerdictOf } from '@/lib/upload-screening/quarantine'

interface FileSourcesTabProps {
  onDeleteFile?: (id: string) => void
}

const UploadErrorAlert: FC<{ message: string; onClose: () => void; className?: string }> = ({
  message,
  onClose,
  className,
}) => {
  const t = useTranslations(researchCopy)
  return (
  <Alert variant="destructive" className={className}>
    <AlertDescription className="flex w-full items-start justify-between gap-2">
      <span>
        {message}
        <UploadAnywayButton className="flex" />
      </span>
      <button data-attr="chat-close"
        type="button"
        onClick={onClose}
        aria-label={t('dismissError')}
        className="shrink-0 rounded-xs opacity-70 transition-opacity duration-quick ease-out hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </AlertDescription>
  </Alert>
  )
}

export const FileSourcesTab: FC<FileSourcesTabProps> = ({ onDeleteFile }) => {
  const t = useTranslations(researchCopy)
  const currentConversationId = useChatStore((state) => state.currentConversation?.id)
  const ensureSession = useChatStore((state) => state.ensureSession)
  const ensureConversationExists = useChatStore((state) => state._ensureConversationExists)
  const projectId = useChatStore((state) => state.projectId)
  const [uploadTarget, setUploadTarget] = useState<'project' | 'session'>(
    projectId ? 'project' : 'session'
  )
  const [projectCollectionName, setProjectCollectionName] = useState<string | undefined>(undefined)

  const knowledgeLayerAvailable = useLayoutStore((state) => state.knowledgeLayerAvailable)

  const { fileUpload: fileUploadConfig } = useAppConfig()

  useEffect(() => {
    if (!projectId) {
      setUploadTarget('session')
      setProjectCollectionName(undefined)
      return
    }

    let cancelled = false
    setUploadTarget('project')

    getProjectCollection(projectId)
      .then((project) => {
        if (!cancelled) {
          setProjectCollectionName(project.collectionName)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectCollectionName(undefined)
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectId])

  const isProjectTarget = uploadTarget === 'project' && !!projectId
  const isProjectTargetReady = isProjectTarget && !!projectCollectionName
  const targetCollectionName = isProjectTarget ? projectCollectionName : currentConversationId
  const targetProjectId = isProjectTargetReady ? projectId : undefined

  const {
    uploadFiles,
    deleteFile,
    dismissFiles,
    sessionFiles: targetFiles,
    isUploading,
    isPolling,
    error: uploadError,
    clearError,
  } = useFileUpload({
    collectionName: targetCollectionName,
    projectId: targetProjectId,
    conversationProjectId: projectId,
  })

  const activeCollection = useDocumentsStore((state) => state.currentCollectionName)
  const isLoadingFiles = useDocumentsStore((state) => state.isLoadingFiles)
  const loadedSessionId = useDocumentsStore((state) => state.loadedSessionId)
  const isThisSessionProcessing =
    activeCollection === targetCollectionName && (isUploading || isPolling)

  const sessionId = targetCollectionName
  const hasLoadedForSession = loadedSessionId === sessionId
  const sessionExpectsFiles =
    !!sessionId && !hasLoadedForSession && sessionHasKnownCollection(sessionId)
  const isAwaitingFiles =
    isLoadingFiles || (isThisSessionProcessing && targetFiles.length === 0) || sessionExpectsFiles

  const destination = useUploadDestination(isProjectTarget ? 'project' : 'session')
  const uploadTargetLabel = destination.label
  const uploadDisabled = isUploading || (isProjectTarget && !projectCollectionName)

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [fileIdToDelete, setFileIdToDelete] = useState<string | null>(null)

  const [previewFile, setPreviewFile] = useState<TrackedFile | null>(null)
  const handleOpenPreview = useCallback(
    (fileId: string) => {
      const file = targetFiles.find((f) => f.id === fileId)
      if (file) setPreviewFile(file)
    },
    [targetFiles]
  )

  const handleUpload = useCallback(
    async (files: File[]) => {
      if (isProjectTarget && !projectCollectionName) {
        console.error('Project collection is not ready for upload')
        return
      }
      let sessionId: string | undefined
      if (!isProjectTarget) {
        sessionId = ensureSession()
        if (!sessionId) {
          console.error('Failed to create session for upload')
          return
        }
        await ensureConversationExists()
      }
      await uploadFiles(files, { collectionOverride: sessionId })
    },
    [ensureSession, ensureConversationExists, isProjectTarget, projectCollectionName, uploadFiles]
  )

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleAddFileClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length > 0) {
        handleUpload(files)
      }
      e.target.value = ''
    },
    [handleUpload]
  )

  const handleDeleteClick = useCallback((id: string) => {
    setFileIdToDelete(id)
    setIsDeleteModalOpen(true)
  }, [])

  const handleDismiss = useCallback((id: string) => dismissFiles([id]), [dismissFiles])

  const handleConfirmDelete = useCallback(async () => {
    if (fileIdToDelete) {
      await deleteFile(fileIdToDelete)
      onDeleteFile?.(fileIdToDelete)
      setFileIdToDelete(null)
    }
  }, [fileIdToDelete, deleteFile, onDeleteFile])

  const handleModalOpenChange = useCallback((open: boolean) => {
    setIsDeleteModalOpen(open)
    if (!open) {
      setFileIdToDelete(null)
    }
  }, [])

  const uploadTargetControls = projectId ? (
    <div className="flex flex-col gap-2 rounded-surface bg-muted p-3">
      <span className="text-xs font-medium text-muted-foreground">{t('fileSourcesTab.uploadTo')}</span>
      <div className="flex gap-2">
        <Button
          variant={uploadTarget === 'project' ? 'default' : 'secondary'}
          size="sm"
          onClick={() => setUploadTarget('project')}
          disabled={!projectCollectionName}
        >
          {t('fileSourcesTab.targetProject')}
        </Button>
        <Button
          variant={uploadTarget === 'session' ? 'default' : 'secondary'}
          size="sm"
          onClick={() => setUploadTarget('session')}
        >
          {t('fileSourcesTab.targetSession')}
        </Button>
      </div>
      <span className="text-xs text-muted-foreground">
        {isProjectTarget
          ? projectCollectionName
            ? t('fileSourcesTab.availableInProject')
            : t('fileSourcesTab.preparingCorpus')
          : t('fileSourcesTab.onlyThisSession')}
      </span>
      {isProjectTarget && projectCollectionName && (
        <span className="text-xs text-muted-foreground">
          {t('fileSourcesTab.projectFilesManagedInFiles')}
        </span>
      )}
    </div>
  ) : null

  if (targetFiles.length === 0) {
    if (isAwaitingFiles) {
      return (
        <div className="flex flex-1 flex-col gap-2" aria-busy="true">
          <span className="sr-only">{t('fileSourcesTab.checkingFiles')}</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <FileSourceCardSkeleton key={i} />
          ))}
        </div>
      )
    }

    return (
      <div className="flex flex-1 flex-col gap-4">
        {/* Show info banner when file upload is not available */}
        {uploadTargetControls}

        {!knowledgeLayerAvailable && (
          <Alert variant="info" className="mb-6">
            <AlertDescription>{t('fileSourcesTab.setupBackend')}</AlertDescription>
          </Alert>
        )}

        {/* Crafted empty state when upload is available — the chat file surface
            is often the first place a user attaches a document, so it deserves
            the same designed empty state as the rest of the app, not bare text. */}
        {knowledgeLayerAvailable && (
          <EmptyState
            variant="bare"
            icon={UploadCloud}
            title={t('fileSourcesTab.noAttachedFiles')}
            description={destination.sentence}
          />
        )}

        {/* Upload Error Display */}
        {uploadError && <UploadErrorAlert message={uploadError} onClose={clearError} />}

        {/* File Upload Zone */}
        {knowledgeLayerAvailable && (
          <FileUploadZone
            collectionName={targetCollectionName}
            acceptedTypes={fileUploadConfig.acceptedTypes}
            maxFileSize={fileUploadConfig.maxFileSize}
            onUpload={handleUpload}
            isUploading={uploadDisabled}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={fileUploadConfig.acceptedTypes}
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Upload Error Display */}
      {uploadError && <UploadErrorAlert message={uploadError} onClose={clearError} />}

      {/* Header with count and add button */}
      {uploadTargetControls}

      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {t('fileSourcesTab.filesCount', { target: uploadTargetLabel, count: targetFiles.length })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleAddFileClick}
          disabled={isLoadingFiles || !knowledgeLayerAvailable || uploadDisabled}
          title={
            isLoadingFiles
              ? t('fileSourcesTab.loadingFilesEllipsis')
              : knowledgeLayerAvailable
                ? t('fileSourcesTab.addFiles')
                : t('fileSourcesTab.uploadNotAvailable')
          }
        >
          {t('fileSourcesTab.addFile')}
        </Button>
      </div>

      {/* File list — AnimatePresence lets deleted cards fade out; initial={false}
          keeps hydrated lists static while newly uploaded files animate in */}
      <AnimatePresence initial={false}>
        {targetFiles.map((file) => (
          <FileSourceCard
            key={file.id}
            id={file.id}
            title={file.fileName}
            fileSize={file.fileSize}
            uploadedAt={file.uploadedAt}
            status={mapToDisplayStatus(file.status)}
            errorMessage={
              file.status === 'held' && !file.replacesHeld ? undefined : (file.errorMessage ?? undefined)
            }
            quarantine={file.status === 'held' ? quarantineVerdictOf(file) : null}
            failedWhileReading={failedWhileReading(file)}
            replacesHeld={file.replacesHeld}
            expirationIntervalHours={fileUploadConfig.fileExpirationCheckIntervalHours}
            onDelete={file.status === 'canceled' ? handleDismiss : isProjectTarget ? undefined : handleDeleteClick}
            onOpen={handleOpenPreview}
          />
        ))}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <DeleteFileConfirmationModal
        open={isDeleteModalOpen}
        onOpenChange={handleModalOpenChange}
        onConfirm={handleConfirmDelete}
        fileName={targetFiles.find((f) => f.id === fileIdToDelete)?.fileName}
      />

      {/* Read-only preview opened by tapping an available file row. */}
      <FilePreviewDialog
        file={previewFile ? trackedFileToFileItem(previewFile) : null}
        canManage={false}
        onClose={() => setPreviewFile(null)}
      />
    </div>
  )
}
