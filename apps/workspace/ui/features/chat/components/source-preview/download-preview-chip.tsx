'use client'

import type { FC, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { HoverPeekPanel } from '@/components/ui/hover-peek-panel'
import { useHoverPopover } from '@/hooks/use-hover-popover'
import type { CitationRef } from '../../lib/citations'
import type { SourceKind, SourceTint } from '@/lib/source-kinds'
import { CitationPeek } from '../CitationPeek'
import {
  CitationFace,
  faceClasses,
  faceStyle,
  type CitationDetail,
  type CitationVariant,
} from './citation-face'
import type { DownloadTarget } from './document-target'
import { useCitationDownload } from './use-citation-download'
import { InfoPreviewChip } from './info-preview-chip'

export const DownloadPreviewChip: FC<{
  target: DownloadTarget
  signal: SourceTint
  label: string
  authority?: string
  className?: string
  index?: string
  variant?: CitationVariant
  citation?: CitationRef
  trailing?: ReactNode
  detail?: CitationDetail
  kind: SourceKind
  tier?: string
  bindingNote?: string
  meta?: string
}> = ({
  target,
  signal,
  label,
  authority,
  className,
  index,
  variant = 'chip',
  citation,
  trailing,
  detail,
  kind,
  tier,
  bindingNote,
  meta,
}) => {
  const t = useTranslations(chatCopy)
  const { isDownloading, download } = useCitationDownload(target)
  const peek = useHoverPopover()

  if (!citation) {
    return (
      <InfoPreviewChip
        target={{ kind: 'info', title: target.title, snippet: target.snippet }}
        signal={signal}
        label={label}
        authority={authority}
        tier={tier}
        bindingNote={bindingNote}
        kind={kind}
        className={className}
        index={index}
        meta={meta}
        variant={variant}
        trailing={trailing}
        detail={detail}
        onDownload={() => void download()}
        downloadPending={isDownloading}
      />
    )
  }

  return (
    <>
      <button
        type="button"
        className={cn(faceClasses(variant), className)}
        style={faceStyle(variant, signal)}
        {...peek.triggerProps}
        aria-label={t('sourcePreview.chipAria', { label })}
      >
        <CitationFace
          variant={variant}
          signal={signal}
          label={label}
          authority={authority}
          index={index}
          citation={citation}
          trailing={trailing}
          detail={detail}
        />
      </button>
      <HoverPeekPanel peek={peek} className="w-80 p-3">
        <CitationPeek
          citation={citation}
          snippet={target.snippet}
          onDownload={() => void download()}
          downloadPending={isDownloading}
          supersededBy={target.supersededBy}
        />
      </HoverPeekPanel>
    </>
  )
}
