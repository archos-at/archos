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
import {
  DRAFT_ACTION,
  DraftConflictNotice,
  DraftMenu,
  DraftSaveDialog,
  ProjectChangeNotice,
  openFiledInPlace,
} from './draft-filing-parts'
import { useDraftLife } from '../hooks/use-draft-life'

interface DocumentDraftCardProps {
  title: string
  path: string
  bytes: number
  version: number
  documentId?: string | null
  versionId?: string | null
  versionState?: DocumentVersionState | null
  filedDraftVersion?: number | null
  removed?: boolean | null
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
  const life = useDraftLife(props)
  const { conversationId, projectId, shownFiled, shownDocumentId, href, isFiling } = filing
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

  if (life.removed) {
    return (
      <Card data-testid="document-draft-card" data-removed="true" className={cn(CARD_SHELL, 'gap-1 p-5')}>
        <SectionLabel>{t('cards.fileDraft.removed')}</SectionLabel>
        <ClampedText className="card-title text-muted-foreground">{title}</ClampedText>
        <p className="card-caption text-muted-foreground">
          {t('cards.fileDraft.removedNote')}
          {shownFiled && ` ${t('cards.fileDraft.removedFiled')}`}
        </p>
        {shownFiled && href && shownDocumentId && (
          <a href={href} className={DRAFT_ACTION} data-testid="document-draft-open">
            {t('cards.documentDraft.open')}
          </a>
        )}
      </Card>
    )
  }

  return (
    <Card data-testid="document-draft-card" className={cn(CARD_SHELL, 'relative gap-2 p-5')}>
      <DraftMenu life={life} name={title} filed={shownFiled} onRemoved={() => {}} className="absolute right-2 top-2" />
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

        {filing.canUpdate && (
          <button
            type="button"
            className={DRAFT_ACTION}
            aria-disabled={isFiling || undefined}
            aria-busy={isFiling || undefined}
            onClick={() => void filing.update()}
            data-testid="document-draft-update"
          >
            <StackedLabel
              busy={isFiling}
              idle={t('cards.fileDraft.updateInProject')}
              working={t('cards.fileDraft.updating')}
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
      <ProjectChangeNotice filing={filing} name={title} onFileAsOwn={() => setSaveOpen(true)} />

      {(filing.canFile || filing.projectChange) && (
        <DraftSaveDialog
          filing={filing}
          open={saveOpen}
          onOpenChange={setSaveOpen}
          title={title}
          path={path}
          asOwn={Boolean(filing.projectChange)}
        />
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
