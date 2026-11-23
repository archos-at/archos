'use client'

import { useState, type FC } from 'react'
import Image from 'next/image'
import { FileCode, FileImage, FileSpreadsheet, FileText, Presentation, Sheet, type LucideIcon } from 'lucide-react'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { useFileThumbnailState } from '@/features/knowledge/file-preview'
import { useSeenOnce } from '@/hooks/use-seen-once'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { DraftFileFormat, DraftFileType } from '@/lib/conversations/draft-media'
import { cn } from '@/lib/utils'
import type { DraftFileUrls } from '../lib/document-draft-preview'

const PAGE_EDGE = 124

const FORMAT_GLYPH: Record<DraftFileFormat, LucideIcon> = {
  word: FileText,
  excel: FileSpreadsheet,
  powerpoint: Presentation,
  pdf: FileText,
  image: FileImage,
  csv: Sheet,
  markdown: FileText,
  text: FileCode,
}

interface FileDraftThumbnailProps {
  type: DraftFileType
  name: string
  urls: DraftFileUrls | null
  onOpen: () => void
  className?: string
}

export const FileDraftThumbnail: FC<FileDraftThumbnailProps> = ({ type, name, urls, onOpen, className }) => {
  const t = useTranslations(chatCopy)
  const [ref, seen] = useSeenOnce<HTMLButtonElement>()
  const [imageFailed, setImageFailed] = useState(false)
  const wantsPage = type.preview === 'office' || type.preview === 'pdf'
  const page = useFileThumbnailState(seen && wantsPage && urls ? urls.rendition : null, 'application/pdf', PAGE_EDGE)
  const imageSource = type.preview === 'image' && urls && !imageFailed ? urls.download : null
  const pageSource = page.state === 'drawn' ? page.source : null
  const Glyph = FORMAT_GLYPH[type.format]
  const drawn = Boolean(pageSource || imageSource)

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-label={t('cards.fileDraft.openName', { name })}
      data-testid="file-draft-thumbnail"
      data-drawn={drawn ? 'true' : undefined}
      data-state={wantsPage ? page.state : undefined}
      className={cn(
        'relative flex h-[124px] w-24 shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden',
        'rounded-surface bg-sheet shadow-sm transition-shadow duration-quick ease-out hover:shadow-sheet-pointer',
        'motion-reduce:transition-none',
        FOCUS_RING,
        className,
      )}
    >
      {pageSource ? (
        <Image
          src={pageSource}
          alt={t('cards.fileDraft.pageAlt', { name })}
          fill
          unoptimized
          sizes="96px"
          className="animate-in fade-in-0 duration-base ease-entrance object-cover object-top motion-reduce:animate-none"
        />
      ) : imageSource ? (
        <Image
          src={imageSource}
          alt={t('cards.fileDraft.imageAlt', { name })}
          fill
          unoptimized
          sizes="96px"
          className="object-contain p-2"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <>
          <Glyph className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <span className="text-[11px] leading-4 font-medium text-muted-foreground" aria-hidden>
            {(type.extension || type.format).toUpperCase()}
          </span>
          {wantsPage && page.state === 'loading' && (
            <span className="sr-only" role="status">
              {t('cards.fileDraft.previewPending')}
            </span>
          )}
        </>
      )}
    </button>
  )
}
