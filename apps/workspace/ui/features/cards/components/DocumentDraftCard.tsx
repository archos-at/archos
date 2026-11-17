'use client'

import { useEffect, useState, type FC } from 'react'
import { AnimatePresence, motion, motionInstant, motionQuick, motionQuickExit } from '@/components/motion'
import { Card } from '@/components/ui/card'
import { SectionLabel } from '@/components/ui/section-label'
import { AuthorshipLine } from '@/features/documents/components/authorship-line'
import { documentFilesHref } from '@/features/documents/lib/document-question'
import { openFiledDocument } from '@/features/documents/lib/open-filed-document'
import { useChatStore } from '@/features/chat/store'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { documentLifecycleClient } from '@/lib/documents/lifecycle-client'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import { cn } from '@/lib/utils'
import { useCardDecision } from '../hooks/use-card-decision'
import { DraftFileError, fileConversationDraft } from '../lib/document-draft-filing'
import { fetchConversationDraft } from '../lib/document-draft-preview'
import { CARD_SHELL } from './card-chrome'
import { ClampedText } from './ClampedText'
import { DocumentDraftPreviewDialog } from './DocumentDraftPreviewDialog'
import { StackedLabel } from '@/components/ui/stacked-label'

interface DocumentDraftCardProps {
  title: string
  path: string
  bytes: number
  version: number
  documentId?: string | null
  versionId?: string | null
  versionState?: DocumentVersionState | null
  messageId?: string
  cardKey: string
  decisionsMustPersist?: boolean
}

const ACTION = cn(
  'inline-flex min-h-11 items-center rounded-control font-medium text-primary',
  'transition-colors duration-quick ease-out motion-reduce:transition-none',
  'hover:text-primary/80 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2',
  'aria-disabled:cursor-default aria-disabled:opacity-60',
)

const SUBMITTABLE: ReadonlySet<DocumentVersionState> = new Set(['draft', 'changes_requested'])

const STATE_LABEL: Partial<Record<DocumentVersionState, string>> = {
  in_review: 'inReview',
  changes_requested: 'changesRequested',
  approved: 'approved',
  published: 'published',
  superseded: 'ersetzt',
  rejected: 'changesRequested',
}

function conflictRow(error: unknown): { documentId: string; displayName: string } | null {
  if (!(error instanceof DraftFileError) || error.status !== 409) return null
  const details = error.details
  if (typeof details !== 'object' || details === null) return null
  const { reason, documentId, displayName } = details as {
    reason?: unknown
    documentId?: unknown
    displayName?: unknown
  }
  return reason === 'same-name' && typeof documentId === 'string' && typeof displayName === 'string'
    ? { documentId, displayName }
    : null
}

function isAlreadySubmitted(error: unknown): boolean {
  if (!(error instanceof DraftFileError) || error.status !== 409) return false
  const details = error.details
  if (typeof details !== 'object' || details === null) return false
  return (details as { reason?: unknown }).reason === 'already-submitted'
}

function confinementRefusal(error: unknown): string | null {
  return error instanceof DraftFileError && error.code === 'CONVERSATION_CONFINED' ? error.message : null
}

export const DocumentDraftCard: FC<DocumentDraftCardProps> = ({
  title,
  path,
  bytes,
  version,
  documentId,
  versionId,
  versionState,
  messageId,
  cardKey,
  decisionsMustPersist,
}) => {
  const t = useTranslations(chatCopy)
  const projectId = useChatStore((s) => s.projectId)
  const conversationId = useChatStore((s) => s.currentConversation?.id ?? null)
  const isMobile = useIsMobile()
  const reduced = useReducedMotion()
  const { decision, decide, canDecide } = useCardDecision(messageId, cardKey, {
    mustPersist: decisionsMustPersist,
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFiling, setIsFiling] = useState(false)
  const [filedDoc, setFiledDoc] = useState<{ documentId: string; versionId: string } | null>(null)
  const [restoreFailed, setRestoreFailed] = useState(false)
  const [conflict, setConflict] = useState<{ documentId: string; displayName: string } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)

  const filed = Boolean(documentId && versionId && versionState)
  const shownDocumentId = documentId ?? filedDoc?.documentId ?? null
  const shownFiled = filed || filedDoc !== null
  const href = shownDocumentId && projectId ? documentFilesHref(projectId, shownDocumentId) : null
  const submitted = decision === 'submitted' || (versionState ? !SUBMITTABLE.has(versionState) : false)

  const filedDecision = decision === 'filed'
  const filedKnown = shownFiled || filedDecision

  useEffect(() => {
    if (filed || filedDoc !== null || decision !== 'filed' || !conversationId) return
    let cancelled = false
    setRestoreFailed(false)
    void fileConversationDraft(conversationId, { path, title, force: false }).then(
      (result) => {
        if (cancelled) return
        setFiledDoc({ documentId: result.documentId, versionId: result.versionId })
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

  const stateKey = versionState ? STATE_LABEL[versionState] : undefined

  const stateLabel =
    filed && submitted && stateKey
      ? t(`cards.documentDraft.${stateKey}` as 'cards.documentDraft.inReview')
      : filedKnown
        ? t('cards.documentDraft.filed')
        : t('cards.documentDraft.draftState')

  const file = async (force: boolean) => {
    if (!conversationId || isFiling) return
    setError(null)
    if (!force) setConflict(null)
    setIsFiling(true)
    try {
      const result = await fileConversationDraft(conversationId, { path, title, force })
      setFiledDoc({ documentId: result.documentId, versionId: result.versionId })
      setConflict(null)
      decide('filed')
    } catch (fileError) {
      const row = conflictRow(fileError)
      if (row && !force) {
        setConflict(row)
      } else if (isAlreadySubmitted(fileError)) {
        setError(t('cards.documentDraft.fileSubmitted'))
      } else if (confinementRefusal(fileError)) {
        setError(confinementRefusal(fileError))
      } else {
        setError(t('cards.documentDraft.fileError'))
      }
    } finally {
      setIsFiling(false)
    }
  }

  const loadPreview = async () => {
    if (!conversationId) return
    setPreviewLoading(true)
    setPreviewFailed(false)
    try {
      const draft = await fetchConversationDraft(conversationId, path)
      setPreviewContent(draft.content)
    } catch {
      setPreviewFailed(true)
      setPreviewContent(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  const openPreview = () => {
    setPreviewOpen(true)
    void loadPreview()
  }

  return (
    <Card data-testid="document-draft-card" className={cn(CARD_SHELL, 'gap-2 p-5')}>
      <SectionLabel>{t('cards.documentDraft.eyebrow')}</SectionLabel>

      <div className="flex min-w-0 flex-col">
        {/* Both lines wrap to two and open on a tap: the working directory's
            paths are the model's own words and are regularly longer than the
            thread column, and a `title` attribute is never shown on a phone. */}
        <ClampedText className="card-title text-foreground">{title}</ClampedText>
        <ClampedText className="card-caption font-mono text-muted-foreground">{path}</ClampedText>
        {/* Provenance, in the Files feature's own component and words. Passed a
            literal here rather than a column: every card of this type is a
            document the agent wrote — that is what emits it. */}
        <AuthorshipLine authoredBy="agent" className="mt-0.5" />
      </div>

      {/* The stand and the actions on one line, in that order — the diagram
          card's meta row, for the same reason: what the card KNOWS outranks what
          it offers, and a control on a line of its own reads as a hole in a card
          this small. Neither the counter nor the size is here at all: both live
          in the preview dialog, beside the words they measure. */}
      <p className="card-caption flex flex-wrap items-center gap-x-3 text-muted-foreground">
        {/* The stand's word changes when the draft is filed or sent: the old
            word leaves before the new one arrives, so the row never shows
            both, and a card mounted already filed paints its word at once. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={stateLabel}
            data-testid="document-draft-state"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: reduced ? motionInstant : motionQuick }}
            exit={{ opacity: 0, transition: reduced ? motionInstant : motionQuickExit }}
          >
            {stateLabel}
          </motion.span>
        </AnimatePresence>

        {!filedKnown && conversationId && (
          <button type="button" className={ACTION} onClick={openPreview}>
            {t('cards.documentDraft.preview')}
          </button>
        )}

        {!shownFiled && canDecide && conversationId && (!filedDecision || restoreFailed) && (
          <button
            type="button"
            className={ACTION}
            aria-disabled={isFiling || undefined}
            aria-busy={isFiling || undefined}
            onClick={() => void file(false)}
          >
            <StackedLabel busy={isFiling} idle={t('cards.documentDraft.file')} working={t('cards.documentDraft.filing')} />
          </button>
        )}

        {shownFiled && href && shownDocumentId && (
          <a
            href={href}
            className={ACTION}
            data-testid="document-draft-open"
            onClick={(event) => {
              if (isMobile || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
              event.preventDefault()
              void openFiledDocument({ documentId: shownDocumentId, projectId: projectId as string }).then((opened) => {
                if (!opened) window.location.assign(href)
              })
            }}
          >
            {t('cards.documentDraft.open')}
          </a>
        )}

        {filed && !submitted && canDecide && (
          <button
            type="button"
            className={ACTION}
            aria-disabled={isSubmitting || undefined}
            aria-busy={isSubmitting || undefined}
            onClick={() => void submit()}
          >
            <StackedLabel
              busy={isSubmitting}
              idle={t('cards.documentDraft.submit')}
              working={t('cards.documentDraft.submitting')}
            />
          </button>
        )}
      </p>

      {error && (
        <p className="card-caption text-destructive" data-testid="document-draft-error">
          {error}
        </p>
      )}

      {conflict && !shownFiled && (
        <div className="flex flex-col gap-1" data-testid="document-draft-conflict">
          <p className="card-caption text-muted-foreground">{t('cards.documentDraft.fileConflict')}</p>
          <p className="card-caption flex flex-wrap items-center gap-x-3 text-muted-foreground">
            {projectId && (
              <a
                href={documentFilesHref(projectId, conflict.documentId)}
                className={ACTION}
                data-testid="document-draft-conflict-open"
              >
                {conflict.displayName}
              </a>
            )}
            <button
              type="button"
              className={ACTION}
              aria-disabled={isFiling || undefined}
              aria-busy={isFiling || undefined}
              onClick={() => void file(true)}
            >
              <StackedLabel
                busy={isFiling}
                idle={t('cards.documentDraft.fileAnyway')}
                working={t('cards.documentDraft.filing')}
              />
            </button>
          </p>
        </div>
      )}

      {!shownFiled && conversationId && (
        <DocumentDraftPreviewDialog
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title={title}
          path={path}
          version={version}
          bytes={bytes}
          content={previewContent}
          loading={previewLoading}
          failed={previewFailed}
          onRetry={() => void loadPreview()}
        />
      )}
    </Card>
  )
}
