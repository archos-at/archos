'use client'

import { useEffect, useState } from 'react'
import { documentFilesHref } from '@/features/documents'
import { useChatStore } from '@/features/chat/store'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { documentLifecycleClient } from '@/lib/documents/lifecycle-client'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import { useCardDecision } from './use-card-decision'
import { DraftFileError, fileConversationDraft } from '../lib/document-draft-filing'

export interface DraftFilingInput {
  title: string
  path: string
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

const SUBMITTABLE: ReadonlySet<DocumentVersionState> = new Set(['draft', 'changes_requested'])

const STATE_LABEL: Partial<Record<DocumentVersionState, string>> = {
  in_review: 'inReview',
  changes_requested: 'changesRequested',
  approved: 'approved',
  published: 'published',
  superseded: 'ersetzt',
  rejected: 'changesRequested',
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
  return errorDetails(error, 409)?.reason === 'already-submitted'
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
  documentId,
  versionId,
  versionState,
  messageId,
  cardKey,
  decisionsMustPersist,
}: DraftFilingInput) {
  const t = useTranslations(chatCopy)
  const projectId = useChatStore((s) => s.projectId)
  const conversationId = useChatStore((s) => s.currentConversation?.id ?? null)
  const { decision, decide, canDecide } = useCardDecision(messageId, cardKey, {
    mustPersist: decisionsMustPersist,
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFiling, setIsFiling] = useState(false)
  const [filedDoc, setFiledDoc] = useState<{ documentId: string; versionId: string; folderName?: string } | null>(
    null,
  )
  const [restoreFailed, setRestoreFailed] = useState(false)
  const [conflict, setConflict] = useState<DraftConflict | null>(null)

  const filed = Boolean(documentId && versionId && versionState)
  const shownDocumentId = documentId ?? filedDoc?.documentId ?? null
  const shownFiled = filed || filedDoc !== null
  const href = shownDocumentId && projectId ? documentFilesHref(projectId, shownDocumentId) : null
  const submitted = decision === 'submitted' || (versionState ? !SUBMITTABLE.has(versionState) : false)
  const filedDecision = decision === 'filed'
  const filedKnown = shownFiled || filedDecision

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

  const submit = async () => {
    if (!documentId || !versionId || isSubmitting) return
    setError(null)
    setIsSubmitting(true)
    try {
      await documentLifecycleClient.submit(documentId, versionId)
      decide('submitted')
    } catch {
      setError(t('cards.documentDraft.error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const file = async (force: boolean) => {
    if (!conversationId || isFiling) return
    setError(null)
    if (!force) setConflict(null)
    setIsFiling(true)
    try {
      const result = await fileConversationDraft(conversationId, { path, title, force })
      setFiledDoc(result)
      setConflict(null)
      decide('filed')
    } catch (fileError) {
      const row = conflictRow(fileError)
      if (row && !force) setConflict(row)
      else setError(failureMessage(fileError))
    } finally {
      setIsFiling(false)
    }
  }

  const stateKey = versionState ? STATE_LABEL[versionState] : undefined
  const stateLabel =
    filed && submitted && stateKey
      ? t(`cards.documentDraft.${stateKey}` as 'cards.documentDraft.inReview')
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
    folderName: filedDoc?.folderName ?? null,
    href,
    submitted,
    canFile: !shownFiled && canDecide && Boolean(conversationId) && (!filedDecision || restoreFailed),
    canSubmit: filed && !submitted && canDecide,
    isFiling,
    isSubmitting,
    error,
    conflict,
    stateLabel,
    file,
    submit,
  }
}

export type DraftFiling = ReturnType<typeof useDraftFiling>
