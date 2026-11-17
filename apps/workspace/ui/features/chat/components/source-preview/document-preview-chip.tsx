'use client'

import type { FC, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { HoverPeekPanel } from '@/components/ui/hover-peek-panel'
import type { SourceTint } from '@/lib/source-kinds'
import { useHoverPopover } from '@/hooks/use-hover-popover'
import type { CitationRef } from '../../lib/citations'
import { useDelayedFlag } from '@/hooks/use-transient-flag'
import { thumbnailDocumentId } from '../CitationPageThumbnail'
import { CitationPeek } from '../CitationPeek'
import {
  CitationFace,
  faceClasses,
  faceStyle,
  type CitationDetail,
  type CitationVariant,
} from './citation-face'
import type { DocumentTarget } from './document-target'
import { useDocumentPreview } from './use-document-preview'

export const DocumentPreviewChip: FC<{
  target: DocumentTarget
  signal: SourceTint
  label: string
  authority?: string
  className?: string
  index?: string
  variant?: CitationVariant
  citation?: CitationRef
  trailing?: ReactNode
  detail?: CitationDetail
  onUnrenderable?: () => void
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
  onUnrenderable,
}) => {
  const t = useTranslations(chatCopy)
  const { isResolving, openPreview, dialog } = useDocumentPreview(target, citation)
  const peek = useHoverPopover()
  const showBusy = useDelayedFlag(isResolving)

  const open = (): void => {
    if (isResolving) return
    peek.dismiss()
    void openPreview().then((outcome) => {
      if (outcome === 'downloaded') onUnrenderable?.()
    })
  }

  const face = (
    <button data-attr="chat-open"
      type="button"
      className={cn(faceClasses(variant), className)}
      style={faceStyle(variant, signal)}
      {...peek.triggerProps}
      onClick={open}
      aria-busy={isResolving || undefined}
      aria-haspopup="dialog"
      aria-label={t('sourcePreview.chipAria', { label })}
      title={citation ? undefined : t('sourcePreview.chipAria', { label })}
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
        busy={showBusy}
      />
    </button>
  )

  return (
    <>
      {face}
      {/* Hovering answers the question; clicking commits to the document. An
          openable source used to offer only the commitment, so checking one of
          eight chips meant opening and closing eight near-fullscreen dialogs.
          Without a reference there is nothing to preview, so the chip keeps its
          plain open-on-click behaviour rather than promising a peek it cannot
          fill. */}
      {citation && (
        <HoverPeekPanel peek={peek} className="w-80 p-3">
          <CitationPeek
            citation={citation}
            snippet={target.snippet}
            onOpen={open}
            supersededBy={target.supersededBy}
            thumbnailDocumentId={thumbnailDocumentId(target)}
          />
        </HoverPeekPanel>
      )}
      {dialog}
    </>
  )
}
