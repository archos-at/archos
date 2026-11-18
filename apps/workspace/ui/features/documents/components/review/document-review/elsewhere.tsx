'use client'

import { useRef, type JSX, type RefObject } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { identityInk } from '@/components/ui/avatar-identity'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import type { DocumentReview as ReviewState } from '../../../hooks/use-document-review'
import { useRoomPeers, type RoomPeerState } from '../../../hooks/use-document-room'
import { useScrollTick } from '../../../hooks/use-scroll-tick'
import { pageOf, peerSide, people } from '../../../lib/review-peers'
import { covers } from '../review-stage'

export function Elsewhere({
  review,
  page,
  edge,
  canvas,
  onJump,
}: {
  review: ReviewState
  page: number
  edge: 'above' | 'below'
  canvas: RefObject<HTMLElement | null>
  onJump: (state: RoomPeerState) => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  useScrollTick(canvas)
  const row = useRef<HTMLDivElement | null>(null)
  const node = canvas.current
  const view = node?.getBoundingClientRect() ?? null
  const card = node?.querySelector<HTMLElement>('[data-review-card]')?.getBoundingClientRect() ?? null
  const lane = row.current?.getBoundingClientRect() ?? null
  const overCard = Boolean(card && lane && covers(card, lane))
  const peers = useRoomPeers(review.room)
  const here = people(peers).flatMap((state) => {
    const at = pageOf(state)
    if (at === null) return []
    const y = state.cursor?.page === at ? state.cursor.y : (state.viewport?.y ?? 0.5)
    const layer = node?.querySelector<HTMLElement>(`[data-testid="review-layer-${at}"]`)
    const side = peerSide({ page: at, y }, page, layer?.getBoundingClientRect() ?? null, view)
    return side === edge ? [{ state, at }] : []
  })
  if (here.length === 0) return null
  const Arrow = edge === 'above' ? ArrowUp : ArrowDown
  return (
    <div
      ref={row}
      className={cn(
        'pointer-events-none flex flex-wrap justify-center gap-1.5',
        edge === 'below' && 'absolute bottom-16 left-1/2 z-30 -translate-x-1/2 pointer-coarse:bottom-36',
        overCard && 'invisible'
      )}
      data-testid={`review-elsewhere-${edge}`}
      data-over-card={overCard || undefined}
    >
      {here.map(({ state, at }) => (
        <button data-attr="review-elsewhere"
          key={state.peer.userId}
          type="button"
          data-testid="review-elsewhere"
          aria-label={t('review.elsewhereJump', { name: state.peer.name, page: at })}
          title={t('review.elsewhereJump', { name: state.peer.name, page: at })}
          onClick={() => onJump(state)}
          className="pointer-events-auto inline-flex items-center gap-1 rounded-full py-0.5 pr-2 pl-1.5 text-[11px] leading-4 font-medium text-background shadow-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          style={{ backgroundColor: identityInk(state.peer.userId) }}
        >
          <Arrow className="size-3" aria-hidden />
          {t('review.elsewhere', { name: state.peer.name.split(/\s+/)[0] ?? state.peer.name, page: at })}
        </button>
      ))}
    </div>
  )
}
