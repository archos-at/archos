'use client'

import type { JSX } from 'react'
import { Download, Info, Maximize2, X } from 'lucide-react'

import { ButtonGroup } from '@/components/ui/button-group'
import { ToolbarIconButton } from '@/components/ui/floating-toolbar'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'

import { useFilePreviewStore } from '../stores/file-preview-store'
import { useDocumentActions, type DocumentScope } from './document-actions'
import type { FileItem } from './project-file-workspace'

export function PeekActions({
  file,
  scope,
  onExpand,
  onClose,
}: {
  file: FileItem
  scope: DocumentScope
  onExpand: () => void
  onClose: () => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const actions = useDocumentActions({ document: file, scope })
  const details = useFilePreviewStore((state) => state.peekDetails)
  const setDetails = useFilePreviewStore((state) => state.setPeekDetails)
  const review = useFilePreviewStore((state) => state.peekFullScreen)
  const fullScreenLabel = review ? t('annotations.openReview') : t('assignment.expandFile')
  return (
    <ButtonGroup className="border-base bg-card/60 shrink-0 gap-0.5 shadow-none">
      <ToolbarIconButton
        onClick={() => setDetails(!details)}
        aria-label={t('preview.peekViews.details')}
        aria-expanded={details}
        title={t('preview.peekViews.details')}
        data-testid="file-peek-details-toggle"
        className={details ? 'bg-accent text-foreground' : undefined}
      >
        <Info aria-hidden />
      </ToolbarIconButton>
      <ToolbarIconButton
        onClick={() => void actions.download()}
        disabled={actions.isDownloading}
        aria-label={t('preview.download')}
        title={t('preview.download')}
      >
        {/* A signed URL for a 40 MB plan is not instant, and a button that
            only dims tells the reader their click may not have landed — so
            they click again. The spinner is the acknowledgement, in the
            place the icon was. */}
        {actions.isDownloading ? <Spinner size="xs" aria-hidden /> : <Download aria-hidden />}
      </ToolbarIconButton>
      <ToolbarIconButton
        onClick={() => (review ?? onExpand)()}
        aria-label={fullScreenLabel}
        title={fullScreenLabel}
        data-testid="file-peek-full-screen"
      >
        <Maximize2 aria-hidden />
      </ToolbarIconButton>
      <ToolbarIconButton onClick={onClose} aria-label={t('preview.closePreview')} title={t('preview.closePreview')}>
        <X aria-hidden />
      </ToolbarIconButton>
    </ButtonGroup>
  )
}
