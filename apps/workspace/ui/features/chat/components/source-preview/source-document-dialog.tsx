'use client'

import { useEffect, useRef, type FC } from 'react'
import { Link2 } from 'lucide-react'
import { capturePosthog } from '@/lib/analytics/posthog'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { RisDocumentDialog } from '@/features/knowledge/components/ris-document-dialog'
import { SourceSignalChip } from '@/features/layout/components/SourceSignalChip'
import type { SourceTint } from '@/lib/source-kinds'
import { citedFileName, resolveCitationTarget, type CitationRef } from '../../lib/citations'
import { useChatStore } from '../../store'
import { CopySourceCitationButton } from '../CopyCitation'
import { CopyCitationLinkButton } from '../CopyCitationLink'
import { documentProjectId } from './citation-label'
import { useConversationId, useSourcePreviewIndex } from './use-source-preview-index'
import { useCitationDownload } from './use-citation-download'
import { useDocumentPreview } from './use-document-preview'
import { EMPTY_DOCUMENT_TARGET } from './document-target'

export const SourceDocumentDialog: FC<{
  citation: CitationRef
  onClose: () => void
}> = ({ citation, onClose }) => {
  const projectId = useChatStore((s) => s.projectId)
  const conversationId = useConversationId()
  const previewIndex = useSourcePreviewIndex(
    documentProjectId(citation.document, projectId),
    conversationId,
    !citation.document.url,
    citedFileName(citation.document)
  )
  const target = resolveCitationTarget(citation.document, {
    locus: citation.locus,
    storedDocuments: previewIndex?.storedDocuments,
    baseCorpusFiles: previewIndex?.baseCorpusFiles,
  })
  const isDocument = target.kind === 'document'
  const isRis = target.kind === 'ris'
  const downloadTarget = target.kind === 'download' ? target : null
  const { download } = useCitationDownload(downloadTarget)
  const { openPreview, dialog, isOpen } = useDocumentPreview(
    isDocument ? target : EMPTY_DOCUMENT_TARGET,
    citation
  )

  const openedReportedRef = useRef(false)
  const reportOpened = (viewer: 'document' | 'ris'): void => {
    if (openedReportedRef.current) return
    openedReportedRef.current = true
    capturePosthog('citation_opened', {
      source_kind: citation.document.kind,
      verified: Boolean(citation.locus?.key.endsWith('#quote')),
      viewer,
    })
  }

  useEffect(() => {
    if (isDocument && !isOpen)
      void openPreview(citation.locus).then((outcome) => {
        if (outcome === 'opened') reportOpened('document')
        else onClose()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDocument])

  const downloadStartedRef = useRef(false)
  useEffect(() => {
    if (!downloadTarget || downloadStartedRef.current) return
    downloadStartedRef.current = true
    void download().finally(onClose)
  }, [downloadTarget, download, onClose])

  useEffect(() => {
    if (isRis || downloadTarget) return
    if (isDocument && previewIndex && !isOpen) return
    if (previewIndex && !isDocument) onClose()
  }, [previewIndex, isDocument, isRis, downloadTarget, isOpen, onClose])

  useEffect(() => {
    if (isRis) reportOpened('ris')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRis])

  if (isRis && target.kind === 'ris') {
    return (
      <RisDocumentDialog
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        url={target.url}
        title={target.title}
        highlight={target.snippet}
        highlightColor={`var(--source-${citation.document.tint})`}
        headerChip={<RisHeaderChip signal={citation.document.tint} />}
        headerActions={
          <span className="flex shrink-0 items-center gap-2">
            <CopyCitationLinkButton citation={citation} icon={<Link2 className="size-3" />} />
            <CopySourceCitationButton citation={citation} />
          </span>
        }
      />
    )
  }

  if (downloadTarget) return null
  if (!isDocument) return null
  return <>{dialog}</>
}

const RisHeaderChip: FC<{ signal: SourceTint }> = ({ signal }) => {
  const t = useTranslations(chatCopy)
  return <SourceSignalChip signal={signal}>{t('sourcePreview.risDocument')}</SourceSignalChip>
}
