'use client'

import type { FC } from 'react'
import { PageRegionThumbnail } from '@/features/knowledge/components/page-region-thumbnail'
import type { PageRegion } from '@/features/knowledge/lib/page-region'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { CitationTarget } from '../lib/citations'

const THUMBNAIL_WIDTH = 288

export const thumbnailDocumentId = (target: CitationTarget): string | undefined => {
  if (target.kind !== 'document' || target.document.type !== 'stored') return undefined
  const { id, filename, contentType } = target.document
  const isPdf = (contentType ?? '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(filename)
  return isPdf ? id : undefined
}

export const CitationPageThumbnail: FC<{
  documentId: string
  page: number
  regions: readonly PageRegion[]
  color?: string
}> = ({ documentId, page, regions, color }) => {
  const t = useTranslations(chatCopy)
  return (
    <PageRegionThumbnail
      data-citation-thumbnail=""
      place={{ document: { id: documentId, name: '', shelf: 'stored' }, page, frame: 'page', region: null }}
      clip={false}
      lazy={false}
      width={THUMBNAIL_WIDTH}
      marks={regions}
      color={color}
      label={regions.find((region) => region.label)?.label ?? t('citationPeek.pageThumbnail', { page })}
      fallback="none"
      className="max-w-72 justify-start"
    />
  )
}
