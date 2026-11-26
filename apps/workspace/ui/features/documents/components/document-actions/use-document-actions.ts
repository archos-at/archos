'use client'

import { useCallback, useContext, useState } from 'react'
import { toast } from 'sonner'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { DOCUMENT_SCOPE_COPY, scopeHasBin, type DocumentScope } from './document-scope'
import { formatCalendarDate } from '@/lib/format'
import { startDocumentDownload } from '@/lib/documents/download'
import { notifyDocumentsChanged } from '@/lib/documents/document-changes'
import { documentDisplayName, type NamedDocument } from '@/lib/documents/display-name'
import { LEGAL_HOLD_REASON } from '@/lib/compliance/legal-hold-codes'
import { documentBinResultSchema } from '@/lib/projects/document-bin-wire'
import { INGEST_RUNNING } from '@/lib/documents/reingest-codes'
import { requestReingest } from '../../lib/reingest-request'
import { requestCancelIngest } from '../../lib/cancel-request'
import { moveConflictRow, movePatchBody, nameConflictOfResponse, type SentConflictChoice } from '../../lib/name-conflict'
import { NameConflictAskContext } from '../../hooks/use-name-conflict-prompt'


export interface ActionableDocument extends NamedDocument {
  id: string
  status?: string | null
  authoredBy?: string | null
  folderId?: string | null
  contentType?: string | null
}

export interface UseDocumentActionsOptions {
  document: ActionableDocument
  scope: DocumentScope
  onRenamed?: (documentId: string, displayName: string | null) => void
  onReingested?: (documentId: string, status: string) => void
  onCancelled?: (documentId: string, status: string) => void
  onDeleted?: (documentId: string) => void
  onMoved?: (documentId: string, folderId: string | null) => void
  folderPath?: (folderId: string | null | undefined, name: string) => string
}

export type RenameOutcome = 'renamed' | 'failed' | 'nameTaken'

export interface DocumentActions {
  name: string
  isRenamed: boolean
  isRenaming: boolean
  isDeleting: boolean
  erases: boolean
  isDownloading: boolean
  isReingesting: boolean
  isCancelling: boolean
  downloadFailed: boolean
  rename: (displayName: string | null) => Promise<RenameOutcome>
  remove: () => Promise<boolean>
  download: () => Promise<void>
  downloadPdf: () => Promise<void>
  reingest: () => Promise<string | null>
  cancel: () => Promise<boolean>
  isMoving: boolean
  move: (folderId: string | null, folderName: string) => Promise<boolean>
}

async function isLegalHoldRefusal(res: Response): Promise<boolean> {
  const body: unknown = await res.json().catch(() => null)
  if (!body || typeof body !== 'object') return false
  const details = (body as { details?: unknown }).details
  return (
    !!details &&
    typeof details === 'object' &&
    (details as { reason?: unknown }).reason === LEGAL_HOLD_REASON
  )
}

const HELD_STATUS = 'quarantined'

function removal(erases: boolean, documentId: string): [string, RequestInit] {
  const document = `/api/documents/${encodeURIComponent(documentId)}`
  return erases ? [document, { method: 'DELETE' }] : [`${document}/bin`, { method: 'POST' }]
}

async function binnedUntil(res: Response): Promise<string | null> {
  const parsed = documentBinResultSchema.safeParse(await res.json().catch(() => null))
  return parsed.success ? parsed.data.purgeAfter : null
}

export function useDocumentActions({
  document,
  scope,
  onRenamed,
  onDeleted,
  onReingested,
  onCancelled,
  onMoved,
  folderPath,
}: UseDocumentActionsOptions): DocumentActions {
  const t = useTranslations(DOCUMENT_SCOPE_COPY[scope])
  const tFiles = useTranslations(filesCopy)
  const { locale } = useLocale()
  const askConflicts = useContext(NameConflictAskContext)
  const [isRenaming, setIsRenaming] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isReingesting, setIsReingesting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isMoving, setIsMoving] = useState(false)
  const [downloadFailed, setDownloadFailed] = useState(false)

  const name = documentDisplayName(document)
  const isRenamed = name !== document.filename
  const erases = document.status === HELD_STATUS || !scopeHasBin(scope)

  const rename = useCallback(
    async (displayName: string | null): Promise<RenameOutcome> => {
      setIsRenaming(true)
      try {
        const res = await fetch(`/api/documents/${document.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName }),
        })
        if (await nameConflictOfResponse(res)) return 'nameTaken'
        if (!res.ok) throw new Error(`Rename failed (${res.status})`)
        const body: unknown = await res.json().catch(() => null)
        const stored =
          body !== null && typeof body === 'object' && 'displayName' in body
            ? ((body as { displayName: string | null }).displayName ?? null)
            : displayName
        notifyDocumentsChanged()
        onRenamed?.(document.id, stored)
        toast.success(
          stored === null
            ? t('rename.restored', { name: document.filename })
            : t('rename.success', { name: stored })
        )
        return 'renamed'
      } catch {
        toast.error(t('rename.error'))
        return 'failed'
      } finally {
        setIsRenaming(false)
      }
    },
    [document.id, document.filename, onRenamed, t]
  )

  const remove = useCallback(async (): Promise<boolean> => {
    setIsDeleting(true)
    try {
      const res = await fetch(...removal(erases, document.id))
      if (res.status === 409 && (await isLegalHoldRefusal(res))) {
        toast.error(t('delete.legalHold'))
        return false
      }
      if (!res.ok && res.status !== 204) throw new Error(`Delete failed (${res.status})`)
      const restorableUntil = erases ? null : await binnedUntil(res)
      notifyDocumentsChanged()
      toast.success(
        restorableUntil
          ? tFiles('workspace.binFolderDone', { name, date: formatCalendarDate(restorableUntil, locale) })
          : t('delete.success', { name })
      )
      onDeleted?.(document.id)
      return true
    } catch {
      toast.error(erases ? tFiles('erase.error') : t('delete.error'))
      return false
    } finally {
      setIsDeleting(false)
    }
  }, [document.id, name, onDeleted, erases, t, tFiles, locale])

  const download = useCallback(async (): Promise<void> => {
    setDownloadFailed(false)
    setIsDownloading(true)
    try {
      if (!(await startDocumentDownload(document.id, name))) setDownloadFailed(true)
    } finally {
      setIsDownloading(false)
    }
  }, [document.id, name])

  const downloadPdf = useCallback(async (): Promise<void> => {
    setDownloadFailed(false)
    setIsDownloading(true)
    try {
      if (!(await startDocumentDownload(document.id, name, { format: 'pdf' }))) setDownloadFailed(true)
    } finally {
      setIsDownloading(false)
    }
  }, [document.id, name])

  const reingest = useCallback(async (): Promise<string | null> => {
    setIsReingesting(true)
    try {
      const outcome = await requestReingest(document.id)
      if (outcome.kind === 'failed') {
        toast.error(t('actions.reingestError'))
        return null
      }
      if (outcome.kind === 'unchanged') {
        toast.info(t('actions.reingestWouldFailAgain'))
        return null
      }
      if (outcome.kind === 'settled') {
        toast.info(t(outcome.code === INGEST_RUNNING ? 'actions.reingestRunning' : 'actions.reingestAlreadyDone'))
      }
      notifyDocumentsChanged()
      if (outcome.status) onReingested?.(document.id, outcome.status)
      return outcome.status
    } finally {
      setIsReingesting(false)
    }
  }, [document.id, onReingested, t])

  const cancel = useCallback(async (): Promise<boolean> => {
    setIsCancelling(true)
    try {
      const outcome = await requestCancelIngest(document.id)
      if (outcome.kind === 'failed') {
        toast.error(t('actions.cancelError'))
        return false
      }
      if (outcome.kind === 'finished') {
        toast.info(t('actions.cancelFinished'))
        return false
      }
      if (outcome.kind === 'unavailable') {
        toast.info(t('actions.cancelUnavailable'))
        return false
      }
      notifyDocumentsChanged()
      toast.success(t('actions.cancelled', { name }))
      onCancelled?.(document.id, 'cancelled')
      return true
    } finally {
      setIsCancelling(false)
    }
  }, [document.id, name, onCancelled, t])

  const move = useCallback(
    async (folderId: string | null, folderName: string): Promise<boolean> => {
      setIsMoving(true)
      const send = (onConflict?: SentConflictChoice) =>
        fetch(`/api/documents/${document.id}/folder`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: movePatchBody(folderId, onConflict),
        })
      try {
        let res = await send()
        const conflict = await nameConflictOfResponse(res)
        let movedAs = name
        if (conflict) {
          const choice = askConflicts
            ? (await askConflicts({ operation: 'move', folderName, rows: [moveConflictRow({ id: document.id, name, path: folderPath?.(document.folderId, name) ?? name }, conflict)] }))?.get(
                document.id
              )
            : undefined
          if (!choice || choice === 'skip') {
            if (!askConflicts) toast.error(tFiles('errors.nameConflict', { name }))
            return false
          }
          res = await send(choice)
          if (res.ok && choice === 'replace') {
            notifyDocumentsChanged()
            onDeleted?.(document.id)
            toast.success(tFiles('nameConflicts.movedAsRevision', { name, existing: conflict.existingName }))
            return true
          }
          movedAs = conflict.suggestedName
        }
        if (res.status === 409) {
          toast.error(tFiles('folders.access.ifcRefused'))
          return false
        }
        if (!res.ok) throw new Error(`Move failed (${res.status})`)
        onMoved?.(document.id, folderId)
        if (movedAs !== name) notifyDocumentsChanged()
        toast.success(t('actions.moved', { name: movedAs, folder: folderName }))
        return true
      } catch {
        toast.error(t('actions.moveError'))
        return false
      } finally {
        setIsMoving(false)
      }
    },
    [document.id, document.folderId, name, onMoved, onDeleted, askConflicts, folderPath, t, tFiles]
  )

  return {
    name,
    isRenamed,
    isRenaming,
    isDeleting,
    erases,
    isDownloading,
    isReingesting,
    isCancelling,
    isMoving,
    downloadFailed,
    rename,
    remove,
    download,
    downloadPdf,
    reingest,
    cancel,
    move,
  }
}
