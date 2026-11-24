'use client'

import { useEffect, useRef, useState } from 'react'
import { documentFilesHref } from '@/features/documents/chat-card-parts'
import { useChatStore } from '@/features/chat/store'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { filesCopy } from '@/i18n/namespaces/files'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import { useCardDecision } from './use-card-decision'
import { DraftFileError, fileConversationDraft, type DraftDestination } from '../lib/document-draft-filing'

export type DraftFileOutcome = 'filed' | 'conflict' | 'failed'

export interface DraftFilingInput {
  title: string
  path: string
  version?: number
  filedDraftVersion?: number | null
  documentId?: string | null
  versionId?: string | null
  versionState?: DocumentVersionState | null
  messageId?: string
  cardKey: string
  decisionsMustPersist?: boolean
}

export interface DraftConflict {
  documentId: string
  displayName: string
}

export interface ProjectChange {
  versionNumber: number | null
}

interface FiledDoc {
  documentId: string
  versionId: string
  folderId?: string | null
  folderName?: string | null
  draftVersion?: number
  outcome?: 'filed' | 'unchanged' | 'updated' | 'revised'
  state?: string
  versionNumber?: number | null
  revisionOf?: { documentId: string; name: string } | null
}

function errorDetails(error: unknown, status: number): Record<string, unknown> | null {
  if (!(error instanceof DraftFileError) || error.status !== status) return null
  const details = error.details
  return typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : null
}

function conflictRow(error: unknown): DraftConflict | null {
  const details = errorDetails(error, 409)
  if (!details) return null
  const { reason, documentId, displayName } = details
  return reason === 'same-name' && typeof documentId === 'string' && typeof displayName === 'string'
    ? { documentId, displayName }
    : null
}

function isAlreadySubmitted(error: unknown): boolean {
  const reason = errorDetails(error, 409)?.reason
  return reason === 'already-submitted' || reason === 'in-review'
}

function projectChangeOf(error: unknown): ProjectChange | null {
  const details = errorDetails(error, 409)
  if (details?.reason !== 'changed-in-project') return null
  return { versionNumber: typeof details.versionNumber === 'number' ? details.versionNumber : null }
}

function isNotFileable(error: unknown): boolean {
  return errorDetails(error, 422)?.reason === 'not-fileable'
}

function confinementRefusal(error: unknown): string | null {
  return error instanceof DraftFileError && error.code === 'CONVERSATION_CONFINED' ? error.message : null
}

export function useDraftFiling({
  title,
  path,
  version,
  filedDraftVersion,
  documentId,
  versionId,
  versionState,
  messageId,
  cardKey,
  decisionsMustPersist,
}: DraftFilingInput) {
  const t = useTranslations(chatCopy)
  const tFiles = useTranslations(filesCopy)
  const projectId = useChatStore((s) => s.projectId)
  const conversationId = useChatStore((s) => s.currentConversation?.id ?? null)
  const { decision, decide, canDecide } = useCardDecision(messageId, cardKey, {
    mustPersist: decisionsMustPersist,
  })
  const [error, setError] = useState<string | null>(null)
  const [isFiling, setIsFiling] = useState(false)
  const [filedDoc, setFiledDoc] = useState<FiledDoc | null>(null)
  const [projectChange, setProjectChange] = useState<ProjectChange | null>(null)
  const destination = useRef<DraftDestination | undefined>(undefined)
  const [restoreFailed, setRestoreFailed] = useState(false)
  const [conflict, setConflict] = useState<DraftConflict | null>(null)

  const filed = Boolean(documentId && versionId && versionState)
  const shownDocumentId = filedDoc?.documentId ?? documentId ?? null
  const filedAtVersion = filedDoc?.draftVersion ?? filedDraftVersion ?? null
  const shownFiled = filed || filedDoc !== null
  const href = shownDocumentId && projectId ? documentFilesHref(projectId, shownDocumentId) : null
  const filedDecision = decision === 'filed'
  const filedKnown = shownFiled || filedDecision
  const changedSinceFiling =
    shownFiled && version !== undefined && filedAtVersion !== null && version > filedAtVersion

  const failureMessage = (fileError: unknown): string => {
    if (isAlreadySubmitted(fileError)) return t('cards.documentDraft.fileSubmitted')
    if (isNotFileable(fileError)) return t('cards.fileDraft.notFileable')
    return confinementRefusal(fileError) ?? t('cards.documentDraft.fileError')
  }

  useEffect(() => {
    if (filed || filedDoc !== null || decision !== 'filed' || !conversationId) return
    let cancelled = false
    setRestoreFailed(false)
    void fileConversationDraft(conversationId, { path, title, force: false }).then(
      (result) => {
        if (cancelled) return
        setFiledDoc(result)
        setConflict(null)
      },
      (restoreError: unknown) => {
        if (cancelled) return
        const row = conflictRow(restoreError)
        if (row) {
          setConflict(row)
        } else if (isAlreadySubmitted(restoreError)) {
          setError(t('cards.documentDraft.fileSubmitted'))
        } else {
          setError(t('cards.documentDraft.fileError'))
          setRestoreFailed(true)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [filed, filedDoc, decision, conversationId, path, title, t])

  const file = async (force: boolean, chosen?: DraftDestination): Promise<DraftFileOutcome> => {
    if (!conversationId || isFiling) return 'failed'
    if (chosen) destination.current = chosen
    setError(null)
    setProjectChange(null)
    if (!force) setConflict(null)
    setIsFiling(true)
    try {
      const result = await fileConversationDraft(conversationId, {
        path,
        title,
        force,
        destination: destination.current,
      })
      setFiledDoc(result)
      setConflict(null)
      decide('filed')
      return 'filed'
    } catch (fileError) {
      const row = conflictRow(fileError)
      if (row && !force) {
        setConflict(row)
        return 'conflict'
      }
      const changed = projectChangeOf(fileError)
      if (changed) {
        setProjectChange(changed)
        return 'conflict'
      }
      setError(failureMessage(fileError))
      return 'failed'
    } finally {
      setIsFiling(false)
    }
  }

  const update = (): Promise<DraftFileOutcome> => file(false, {})
  const fileOverChanges = (): Promise<DraftFileOutcome> => file(false, { overChanges: true })
  const fileAsOwn = (): Promise<DraftFileOutcome> => file(false, { as: 'own' })

  const revised = filedDoc?.outcome === 'revised' && filedDoc.revisionOf ? filedDoc.revisionOf : null
  const folderName =
    filedDoc && filedDoc.folderName !== undefined ? (filedDoc.folderName ?? tFiles('folders.allFiles')) : null
  const stateLabel = changedSinceFiling
    ? t('cards.fileDraft.changedSinceFiling')
    : revised
      ? filedDoc?.versionNumber
        ? t('cards.fileDraft.revisedFiledNumbered', { name: revised.name, number: String(filedDoc.versionNumber) })
        : t('cards.fileDraft.revisedFiled', { name: revised.name })
      : filedDoc?.outcome === 'updated'
        ? t('cards.fileDraft.updated')
        : folderName && !filed
        ? t('cards.fileDraft.filedIn', { folder: folderName })
        : filedKnown
          ? t('cards.documentDraft.filed')
          : t('cards.documentDraft.draftState')

  return {
    projectId,
    conversationId,
    canDecide,
    filed,
    filedKnown,
    shownFiled,
    shownDocumentId,
    folderName,
    href,
    canFile: !shownFiled && canDecide && Boolean(conversationId) && (!filedDecision || restoreFailed),
    canUpdate: changedSinceFiling && canDecide && Boolean(conversationId) && projectChange === null,
    changedSinceFiling,
    projectChange,
    isFiling,
    error,
    conflict,
    stateLabel,
    file,
    update,
    fileOverChanges,
    fileAsOwn,
  }
}

export type DraftFiling = ReturnType<typeof useDraftFiling>
