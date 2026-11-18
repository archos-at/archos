'use client'

import { useState, type FC } from 'react'
import { AnimatePresence, motion, motionInstant, motionQuick, motionQuickExit } from '@/components/motion'
import { Card } from '@/components/ui/card'
import { SectionLabel } from '@/components/ui/section-label'
import { StackedLabel } from '@/components/ui/stacked-label'
import { AuthorshipLine } from '@/features/documents/chat-card-parts'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import { cn } from '@/lib/utils'
import { useDraftFiling } from '../hooks/use-draft-filing'
import { fetchConversationDraft } from '../lib/document-draft-preview'
import { CARD_SHELL } from './card-chrome'
import { ClampedText } from './ClampedText'
import { DocumentDraftPreviewDialog } from './DocumentDraftPreviewDialog'
import { DRAFT_ACTION, DraftConflictNotice, DraftSaveDialog, openFiledInPlace } from './draft-filing-parts'

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

export const DocumentDraftCard: FC<DocumentDraftCardProps> = (props) => {
  const { title, path, bytes, version } = props
  const t = useTranslations(chatCopy)
  const isMobile = useIsMobile()
  const reduced = useReducedMotion()
  const filing = useDraftFiling(props)
  const { conversationId, projectId, shownFiled, shownDocumentId, href, isFiling, isSubmitting } = filing
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)

  const loadPreview = async () => {
    if (!conversationId) return
    setPreviewLoading(true)
    setPreviewFailed(false)
    try {
      const draft = await fetchConversationDraft(conversationId, path)
      setPreviewContent(draft.content ?? null)
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
        <ClampedText className="card-title text-foreground">{title}</ClampedText>
        <ClampedText className="card-caption font-mono text-muted-foreground">{path}</ClampedText>
        <AuthorshipLine authoredBy="agent" className="mt-0.5" />
      </div>

      <p className="card-caption flex flex-wrap items-center gap-x-3 text-muted-foreground">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={filing.stateLabel}
            data-testid="document-draft-state"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: reduced ? motionInstant : motionQuick }}
            exit={{ opacity: 0, transition: reduced ? motionInstant : motionQuickExit }}
          >
            {filing.stateLabel}
          </motion.span>
        </AnimatePresence>

        {!filing.filedKnown && conversationId && (
          <button type="button" className={DRAFT_ACTION} onClick={openPreview}>
            {t('cards.documentDraft.preview')}
          </button>
        )}

        {filing.canFile && (
          <button
            type="button"
            className={DRAFT_ACTION}
            aria-disabled={isFiling || undefined}
            aria-busy={isFiling || undefined}
            onClick={() => (filing.projectId ? setSaveOpen(true) : void filing.file(false))}
            data-testid="document-draft-file"
          >
            <StackedLabel busy={isFiling} idle={t('cards.documentDraft.file')} working={t('cards.documentDraft.filing')} />
          </button>
        )}

        {shownFiled && href && shownDocumentId && (
          <a
            href={href}
            className={DRAFT_ACTION}
            data-testid="document-draft-open"
            onClick={(event) =>
              openFiledInPlace(event, { documentId: shownDocumentId, projectId: projectId as string, href, isMobile })
            }
          >
            {t('cards.documentDraft.open')}
          </a>
        )}

        {filing.canSubmit && (
          <button
            type="button"
            className={DRAFT_ACTION}
            aria-disabled={isSubmitting || undefined}
            aria-busy={isSubmitting || undefined}
            onClick={() => void filing.submit()}
          >
            <StackedLabel
              busy={isSubmitting}
              idle={t('cards.documentDraft.submit')}
              working={t('cards.documentDraft.submitting')}
            />
          </button>
        )}
      </p>

      {filing.error && !saveOpen && (
        <p className="card-caption text-destructive" data-testid="document-draft-error">
          {filing.error}
        </p>
      )}

      <DraftConflictNotice filing={filing} />

      {filing.canFile && (
        <DraftSaveDialog filing={filing} open={saveOpen} onOpenChange={setSaveOpen} title={title} path={path} />
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
