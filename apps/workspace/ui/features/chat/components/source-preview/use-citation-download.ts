'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { startDocumentDownload } from '@/lib/documents/download'
import type { DownloadTarget } from './document-target'

export const useCitationDownload = (
  target: DownloadTarget | null
): { isDownloading: boolean; download: () => Promise<void> } => {
  const t = useTranslations(chatCopy)
  const [isDownloading, setIsDownloading] = useState(false)

  const download = async (): Promise<void> => {
    if (!target) return
    setIsDownloading(true)
    try {
      if (!(await startDocumentDownload(target.document.id, target.fileName))) {
        toast.error(t('sourcePreview.loadFailed'))
      }
    } finally {
      setIsDownloading(false)
    }
  }

  return { isDownloading, download }
}
