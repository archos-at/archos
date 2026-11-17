import { useCallback, type ClipboardEvent } from 'react'
import { useChatStore } from '@/features/chat/store'
import type { useFileUpload } from '@/features/documents'
import { photoIntake, prepareSitePhotos } from '@/features/documents/lib/site-photo'
import { useAppConfig } from '@/shared/context'
import { useTranslations } from '@/i18n'
import { captureCopy } from '@/i18n/namespaces/capture'
import { researchCopy } from '@/i18n/namespaces/research'
import type { AttachSource } from '../components/ComposerAttach'
import type { SetComposerNote } from '../components/input-area/composer-types'
import { useChatDropTarget } from '../components/chat-drop-zone'
import { useLayoutStore } from '../store'
import { composerDropRefusal } from '../lib/composer-drop-refusal'

interface ComposerAttachmentsInput {
  isAuthenticated: boolean
  cannotContribute: boolean
  isBusy: boolean
  isResponseMode: boolean
  upload: ReturnType<typeof useFileUpload>
  setComposerNote: SetComposerNote
}

export function useComposerAttachments({
  isAuthenticated,
  cannotContribute,
  isBusy,
  isResponseMode,
  upload,
  setComposerNote,
}: ComposerAttachmentsInput) {
  const { uploadFiles, sessionFiles, isUploading } = upload
  const t = useTranslations(researchCopy)
  const { fileUpload: fileUploadConfig } = useAppConfig()
  const photos = photoIntake(fileUploadConfig)
  const tCapture = useTranslations(captureCopy)
  const ensureSession = useChatStore((state) => state.ensureSession)
  const ensureConversationExists = useChatStore((state) => state._ensureConversationExists)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const knowledgeLayerAvailable = useLayoutStore((s) => s.knowledgeLayerAvailable)

  const handleFilesSelected = useCallback(
    async (selected: File[], source: AttachSource = 'picker') => {
      if (selected.length === 0 || cannotContribute || isUploading || isBusy) return

      const { files, unconvertibleHeic } = await prepareSitePhotos(selected, {
        source,
        prefix: tCapture('photos.fileNamePrefix'),
        taken: sessionFiles.map((file) => file.fileName),
        imagesAccepted: photos.available,
      })
      if (unconvertibleHeic.length > 0) {
        setComposerNote({
          text: tCapture('photos.heicUnconvertible', { name: unconvertibleHeic.join(', ') }),
          tone: 'error',
        })
      }
      if (files.length === 0) return

      const sessionId = ensureSession()
      if (!sessionId) {
        console.error('Failed to create session for upload')
        return
      }

      await ensureConversationExists()
      await uploadFiles(files, { collectionOverride: sessionId })
    },
    [
      ensureSession,
      ensureConversationExists,
      uploadFiles,
      cannotContribute,
      isUploading,
      isBusy,
      sessionFiles,
      photos.available,
      tCapture,
      setComposerNote,
    ]
  )

  const attachDropped = useCallback(
    (files: File[]) => void handleFilesSelected(files),
    [handleFilesSelected]
  )
  const dropRefusal = composerDropRefusal({
    canContribute: !cannotContribute,
    isStreaming,
    awaitsAnswer: isResponseMode,
    isUploading,
    knowledgeLayerAvailable,
  })
  useChatDropTarget(
    isAuthenticated
      ? { attach: attachDropped, refusal: dropRefusal ? t(`inputArea.${dropRefusal}`) : null }
      : null
  )

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      void handleFilesSelected(files)
    },
    [handleFilesSelected]
  )

  const attachedFilesCount = sessionFiles.filter(
    (f) =>
      f.status === 'uploading' ||
      f.status === 'ingesting' ||
      f.status === 'success' ||
      f.status === 'held' ||
      f.status === 'stored'
  ).length

  return { photos, tCapture, handleFilesSelected, handlePaste, attachedFilesCount }
}
