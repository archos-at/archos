'use client'

import type { JSX } from 'react'
import { MessageSquareText, RotateCcw, ScanEye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CommentPin } from '@/components/ui/comment-pin'
import { CountPill } from '@/components/ui/count-pill'
import { InspectorGroup, InspectorSection } from '@/components/ui/inspector-group'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { isLive } from '@/lib/annotations/types'
import { cn } from '@/lib/utils'
import type { DocumentReview } from '../../hooks/use-document-review'
import { useRoomSelector } from '../../hooks/use-document-room'
import { MarkBody } from './mark-body'
import { markInk } from './review-page-layer'
import { hasLiveMarks, openMarksShortLabel } from '../open-marks-chip'
import { isAgentKind } from '@/lib/agent-kind'

const PREVIEWED = 3

export function AnnotationsSummary({
  review,
  onOpenReview,
  className,
}: {
  review: DocumentReview
  onOpenReview: (annotationId?: string) => void
  className?: string
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const live = review.annotations.filter(isLive)
  const others = useRoomSelector(
    review.room,
    (peers) => new Set(peers.filter((state) => !isAgentKind(state.peer.kind)).map((state) => state.peer.userId)).size
  )
  const ready = review.load === 'ready'
  return (
    <InspectorSection
      label={t('annotations.section')}
      icon={MessageSquareText}
      action={
        ready && hasLiveMarks(review.counts) ? <CountPill>{openMarksShortLabel(t, review.counts)}</CountPill> : undefined
      }
      className={className}
      data-testid="annotations-summary"
    >
      <InspectorGroup>
        {review.load === 'loading' && (
          <div role="status" aria-label={t('annotations.loading')} className="flex items-center gap-2.5 px-3 py-2.5" data-testid="annotations-summary-loading">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <Skeleton className="h-3 flex-1" />
          </div>
        )}
        {review.load === 'error' && (
          <div className="space-y-2 p-3" data-testid="annotations-summary-error">
            <p className="text-muted-foreground text-xs leading-5">{t('annotations.loadError')}</p>
            <Button type="button" variant="secondary" size="sm" className="h-8 gap-1.5" onClick={review.retry}>
              <RotateCcw className="size-3.5" aria-hidden />
              {t('annotations.retry')}
            </Button>
          </div>
        )}
        {ready && live.length === 0 && (
          <p className="text-muted-foreground px-3 pt-3 text-xs leading-5" data-testid="annotations-summary-empty">
            {t('annotations.empty')}
          </p>
        )}
        {ready &&
          live.slice(0, PREVIEWED).map((annotation) => (
            <button data-attr="annotations-summary-row"
              key={annotation.id}
              type="button"
              data-testid="annotations-summary-row"
              onClick={() => onOpenReview(annotation.id)}
              className="hover:bg-hover border-border/60 flex w-full items-start gap-2.5 border-t px-3 py-2.5 text-left first:border-t-0"
            >
              <CommentPin
                as="span"
                number={annotation.number}
                color={markInk(annotation)}
                proposed={annotation.status === 'proposed'}
              />
              <span className="min-w-0 flex-1">
                <span className="text-foreground line-clamp-2 text-xs leading-5">
                  <MarkBody text={annotation.body} mentions={annotation.mentions} viewerId={review.me} clamped />
                </span>
                {/* Not drawn on this Fassung's pages, so the row says where it was set, as the review's list does. */}
                {!annotation.onCurrentRevision && (
                  <span
                    className="text-muted-foreground mt-0.5 block text-[11px] italic"
                    title={t('annotations.earlierRevisionHint')}
                    data-testid="annotations-summary-earlier"
                  >
                    {annotation.revisionNumber
                      ? t('annotations.earlierRevision', { number: annotation.revisionNumber })
                      : t('annotations.earlierRevisionUnnumbered')}
                  </span>
                )}
              </span>
            </button>
          ))}
        {review.load !== 'error' && (
          <div className={cn('p-2', ready && live.length > 0 && 'border-border/60 border-t')}>
            <Button
              type="button"
              variant={live.length > 0 ? 'ghost' : 'secondary'}
              size="sm"
              className="h-8 w-full justify-center gap-1.5"
              data-testid="open-review"
              onClick={() => onOpenReview()}
            >
              <ScanEye className="size-3.5" aria-hidden />
              {live.length > PREVIEWED ? t('annotations.workOnAll', { count: live.length }) : t('annotations.workOn')}
            </Button>
            {others > 0 && (
              <p className="text-muted-foreground mt-1.5 flex flex-wrap items-center justify-center gap-x-1 text-center text-[11px]">
                {t('review.othersHere', { count: others })}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-[11px]"
                  data-testid="annotations-summary-join"
                  onClick={() => onOpenReview()}
                >
                  {t('annotations.joinIn')}
                </Button>
              </p>
            )}
          </div>
        )}
      </InspectorGroup>
    </InspectorSection>
  )
}
