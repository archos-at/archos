'use client'

import type { FC, ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { HoverPeekPanel } from '@/components/ui/hover-peek-panel'
import { useHoverPopover } from '@/hooks/use-hover-popover'
import type { CitationRef } from '../../lib/citations'
import { SectionLabel } from '@/components/ui/section-label'
import { SourceSignalChip } from '@/features/layout/components/SourceSignalChip'
import type { SourceKind, SourceTint } from '@/lib/source-kinds'
import { PEEK_ACTION_CLASSES, PeekDownloadButton } from '../CitationPeek'
import { CopySourceCitationButton } from '../CopyCitation'
import {
  CitationFace,
  faceClasses,
  faceStyle,
  type CitationDetail,
  type CitationVariant,
} from './citation-face'
import type { InfoTarget } from './document-target'
import { CitedPassageBox } from './cited-passage-box'


export const InfoPreviewChip: FC<{
  target: InfoTarget
  signal: SourceTint
  label: string
  authority?: string
  tier?: string
  bindingNote?: string
  kind: SourceKind
  precedent?: boolean
  url?: string
  className?: string
  index?: string
  meta?: string
  variant?: CitationVariant
  citation?: CitationRef
  trailing?: ReactNode
  detail?: CitationDetail
  onDownload?: () => void
  downloadPending?: boolean
}> = ({
  target,
  signal,
  label,
  authority,
  tier,
  bindingNote,
  url,
  className,
  index,
  meta,
  variant = 'chip',
  citation,
  trailing,
  kind,
  precedent,
  detail,
  onDownload,
  downloadPending,
}) => {
  const t = useTranslations(chatCopy)
  const peek = useHoverPopover()
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
      <HoverPeekPanel peek={peek} className="w-80 space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <SourceSignalChip signal={signal}>
            {t(precedent ? 'sourcePreview.kinds.praezedenz' : `sourcePreview.kinds.${kind}`)}
          </SourceSignalChip>
          {tier && <span className="text-muted-foreground text-xs font-medium">{tier}</span>}
        </div>
        {/* The written source list's payload, one click away: the citation
            number, the untruncated title and the locator. */}
        <p className="text-foreground break-words text-sm font-medium">
          {index && <span className="text-muted-foreground mr-1">[{index}]</span>}
          {target.title}
        </p>
        {meta && <p className="text-muted-foreground text-xs">{meta}</p>}
        {bindingNote && (
          <div
            className="rounded-control px-2.5 py-1.5"
            style={{
                backgroundColor: `var(--source-${signal}-tint, var(--muted))`,
            }}
          >
            <SectionLabel
              as="p"
              style={{ color: `var(--source-${signal}-text, var(--muted-foreground))` }}
            >
              {t('sourcePreview.bindingLabel')}
            </SectionLabel>
            <p className="text-foreground mt-0.5 text-xs leading-relaxed">{bindingNote}</p>
          </div>
        )}
        {target.snippet && <CitedPassageBox snippet={target.snippet} signal={signal} />}
        {/* Why there is no viewer, before the control that works around it. */}
        {onDownload && (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t('citationPeek.noInlineViewer')}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          {onDownload ? (
            <PeekDownloadButton tint={signal} onDownload={onDownload} pending={downloadPending} />
          ) : url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={PEEK_ACTION_CLASSES}
              style={{ color: `var(--source-${signal}-text, var(--foreground))` }}
            >
              {t('sourcePreview.openExternal')}
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          ) : (
            <span />
          )}
          {citation && <CopySourceCitationButton citation={citation} />}
        </div>
      </HoverPeekPanel>
    </>
  )
}
