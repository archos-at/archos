'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'
import { Archive, Boxes, FileText } from 'lucide-react'
import { sourceBase } from '@/lib/ui/source-tint'
import { documentDisplayName } from '@/lib/documents/display-name'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { inferDocumentKind } from '../document-kind'
import type { FileItem } from '../file-types'
import type { FileShelf } from '../lib/file-shelf'
import { useIngestionCompleteToast } from './use-ingestion-complete-toast'

export function useCompletionToast(files: FileItem[], shelf: FileShelf): void {
  const t = useTranslations(filesCopy)
  const { source, messages } = shelf
  useIngestionCompleteToast(
    files,
    useCallback(
      (file: FileItem) => {
        const isModel =
          inferDocumentKind({ filename: file.filename, contentType: file.contentType, tags: file.tags }) ===
          'model'
        const Icon = isModel ? Boxes : source === 'office' ? Archive : FileText
        toast.success(
          isModel
            ? t('toast.modelReady', { name: documentDisplayName(file) })
            : messages.ingestionComplete(documentDisplayName(file)),
          { icon: <Icon className="size-4" style={{ color: sourceBase(source) }} aria-hidden /> }
        )
      },
      [t, source, messages]
    )
  )
}
