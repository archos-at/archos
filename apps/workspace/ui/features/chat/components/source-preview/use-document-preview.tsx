'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { documentFileUrl } from '@/lib/documents/urls'
import { openAtLocus, type CitationLocus, type CitationRef } from '../../lib/citations'
import {
  RENDITION_PENDING_NOTICE_MS,
  asDownloadTarget,
  isImageTarget,
  isRenditionTarget,
  isRenditionUnavailable,
  type DocumentTarget,
} from './document-target'
import { useCitationDownload } from './use-citation-download'
import { CitationDocumentDialog } from './citation-document-dialog'

export type PreviewOutcome = 'opened' | 'downloaded' | 'failed'

export const useDocumentPreview = (target: DocumentTarget, citation?: CitationRef) => {
  const t = useTranslations(chatCopy)
  const [isOpen, setIsOpen] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [activeLocus, setActiveLocus] = useState<CitationLocus | undefined>(() =>
    citation ? openAtLocus(citation.document, citation.locus) : undefined
  )

  useEffect(() => {
    if (citation?.locus) setActiveLocus(openAtLocus(citation.document, citation.locus))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citation?.locus?.key])

  const isImage = isImageTarget(target)
  const rendition = isRenditionTarget(target)
  const { download } = useCitationDownload(asDownloadTarget(target))

  const openPreview = async (locus?: CitationLocus): Promise<PreviewOutcome> => {
    if (locus && citation) setActiveLocus(openAtLocus(citation.document, locus))
    else if (locus) setActiveLocus(locus)
    if (target.document.type === 'base') {
      setIsOpen(true)
      return 'opened'
    }
    setIsResolving(true)
    let pendingToast: string | number | undefined
    const pendingTimer = rendition
      ? setTimeout(() => {
          pendingToast = toast.loading(t('sourcePreview.renditionPending'))
        }, RENDITION_PENDING_NOTICE_MS)
      : undefined
    try {
      const res = await fetch(`/api/documents/${target.document.id}/preview`)
      if (rendition && isRenditionUnavailable(res.status)) {
        clearTimeout(pendingTimer)
        if (pendingToast !== undefined) toast.dismiss(pendingToast)
        await download()
        return 'downloaded'
      }
      const data = res.ok ? await res.json() : null
      if (data?.url) {
        setSrc(isImage ? data.url : documentFileUrl(target.document.id))
        setIsOpen(true)
        return 'opened'
      }
      toast.error(t('sourcePreview.loadFailed'))
      return 'failed'
    } catch {
      toast.error(t('sourcePreview.loadFailed'))
      return 'failed'
    } finally {
      clearTimeout(pendingTimer)
      if (pendingToast !== undefined) toast.dismiss(pendingToast)
      setIsResolving(false)
    }
  }
  const dialog = (
    <CitationDocumentDialog
      target={target}
      citation={citation}
      activeLocus={activeLocus}
      onSelectLocus={setActiveLocus}
      src={src ?? undefined}
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open)
        if (!open) setSrc(null)
      }}
    />
  )

  return { isResolving, openPreview, dialog, isOpen, setIsOpen }
}
