'use client'

import type { JSX } from 'react'
import { identityInk } from '@/components/ui/avatar-identity'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { AnnotationView } from '@/lib/annotations/types'
import { cn } from '@/lib/utils'
import type { RoomPeerState } from '../../../hooks/use-document-room'
import { at, box, tagFitsAbove } from '../../../lib/review-overlay-geometry'
import { firstName } from '../../../lib/review-peer-state'

export function PeerSelection({
  annotation,
  selectors,
  tagged,
  pageHeight,
}: {
  annotation: Pick<AnnotationView, 'shape' | 'x' | 'y' | 'w' | 'h'>
  selectors: readonly RoomPeerState[]
  tagged: readonly RoomPeerState[]
  pageHeight: number
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const first = selectors[0]
  if (!first) return null
  const ink = identityInk(first.peer.userId)
  const names = tagged.map((state) => firstName(state.peer.name))
  const tag = names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0]
  const region = annotation.shape === 'region' && annotation.w && annotation.h ? annotation : null
  const above = region ? tagFitsAbove(region.y, pageHeight) : true
  return (
    <>
      {region ? (
        <span
          aria-hidden
          data-testid="review-peer-selection"
          className="pointer-events-none absolute z-20 rounded-[3px]"
          style={{ ...box(region.x, region.y, region.w ?? 0, region.h ?? 0), outline: `2px solid ${ink}`, outlineOffset: 2 }}
        />
      ) : (
        <span
          aria-hidden
          data-testid="review-peer-selection"
          className="pointer-events-none absolute z-[9] size-8 -translate-x-1 -translate-y-7 rounded-full rounded-bl-none border-2"
          style={{ ...at(annotation.x, annotation.y), borderColor: ink }}
        />
      )}
      {tag && (
        <span
          className={cn(
            'pointer-events-none absolute z-20 rounded-full px-1.5 py-px text-[10px] leading-4 font-medium whitespace-nowrap text-background shadow-sm',
            region
              ? above
                ? '-translate-x-full -translate-y-[calc(100%+4px)]'
                : '-translate-x-[calc(100%+4px)] translate-y-1'
              : 'translate-x-8 -translate-y-6'
          )}
          style={{ ...at(region ? region.x + (region.w ?? 0) : annotation.x, annotation.y), backgroundColor: ink }}
          title={t('review.peerSelected', { names: selectors.map((state) => state.peer.name).join(', ') })}
          data-testid="review-peer-selection-tag"
        >
          {tag}
        </span>
      )}
    </>
  )
}
