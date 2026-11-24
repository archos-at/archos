'use client'

import { useEffect, useState, type FC } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileExtChip } from '@/features/documents/chat-card-parts'
import { PdfViewerDialog } from '@/features/knowledge/file-preview'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { DraftFileType } from '@/lib/conversations/draft-media'
import { fetchConversationDraft, type DraftFileUrls } from '../lib/document-draft-preview'
import { DocumentDraftPreviewDialog } from './DocumentDraftPreviewDialog'

interface FileDraftViewerProps {
  open: boolean
  onClose: () => void
  type: DraftFileType
  name: string
  title: string
  path: string
  version: number
  bytes: number
  conversationId: string
  urls: DraftFileUrls
}

const TextViewer: FC<FileDraftViewerProps> = ({ open, onClose, type, title, path, version, bytes, conversationId }) => {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetchConversationDraft(conversationId, path).then(
      (draft) => {
        if (cancelled) return
        setContent(draft.content ?? null)
        setFailed(draft.content === undefined)
        setLoading(false)
      },
      () => {
        if (cancelled) return
        setContent(null)
        setFailed(true)
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, conversationId, path, version, attempt])

  return (
    <DocumentDraftPreviewDialog
      open={open}
      onClose={onClose}
      title={title}
      path={path}
      version={version}
      bytes={bytes}
      content={content}
      loading={loading}
      failed={failed}
      onRetry={() => setAttempt((count) => count + 1)}
      contentType={type.preview === 'table' ? 'text/csv' : 'text/plain'}
    />
  )
}

export const FileDraftViewer: FC<FileDraftViewerProps> = (props) => {
  const { open, onClose, type, name, title, urls } = props
  const t = useTranslations(chatCopy)

  if (type.preview === 'table' || type.preview === 'text') return <TextViewer {...props} />

  const isImage = type.preview === 'image'
  const description =
    type.preview === 'office'
      ? t('cards.fileDraft.viewerOffice', { format: t(`cards.fileDraft.format.${type.format}` as 'cards.fileDraft.format.word') })
      : t('cards.fileDraft.viewerDraft')

  return (
    <PdfViewerDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      fileName={name}
      title={title}
      src={isImage ? urls.download : urls.rendition}
      isImage={isImage}
      description={description}
      headerChip={<FileExtChip filename={name} size="sm" />}
      headerActions={
        <Button asChild variant="secondary" size="sm">
          <a href={urls.download} download={name} aria-label={t('cards.fileDraft.downloadName', { name })}>
            <Download aria-hidden />
            {t('cards.fileDraft.download')}
          </a>
        </Button>
      }
    />
  )
}
