'use client'

import { useEffect, useRef, useState, type JSX } from 'react'
import { ScanEye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { COMMENT_PIN_ON_POINT, CommentPin } from '@/components/ui/comment-pin'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { DocumentReview } from '../hooks/use-document-review'
import { MarkBody } from './review/mark-body'
import { markInk } from './review/review-page-layer'
import { PRODUCT_NAME } from '@/lib/brand'
import { isAgentKind } from '@/lib/agent-kind'

const OPEN_DELAY_MS = 130
const CLOSE_DELAY_MS = 220

export const HOVER_QUERY = '(hover: hover) and (pointer: fine)'

export function InlineMarkPeek({
  page,
  review,
  onOpenMark,
}: {
  page: number
  review: DocumentReview
  onOpenMark: (annotationId: string) => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const canHover = useMediaQuery(HOVER_QUERY)
  const [shownId, setShownId] = useState<string | null>(null)
  const inCard = useRef(false)
  const hovered = review.hoveredId
  const hoveredRef = useRef(hovered)

  useEffect(() => {
    hoveredRef.current = hovered
    if (!canHover) return
    const timer = window.setTimeout(
      () => {
        if (hovered) setShownId(hovered)
        else if (!inCard.current) setShownId(null)
      },
      hovered ? OPEN_DELAY_MS : CLOSE_DELAY_MS
    )
    return () => window.clearTimeout(timer)
  }, [hovered, canHover])

  const mark = review.annotations.find(
    (annotation) => annotation.id === shownId && annotation.page === page && annotation.onCurrentRevision
  )
  if (!canHover || !mark) return null
  const author = isAgentKind(mark.authorKind) ? PRODUCT_NAME : mark.createdByName
  return (
    <Popover open onOpenChange={(open) => !open && setShownId(null)}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          className={`absolute size-6 ${COMMENT_PIN_ON_POINT}`}
          style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
        />
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        className="w-72 p-3"
        data-testid="inline-mark-peek"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={() => {
          inCard.current = true
        }}
        onPointerLeave={() => {
          inCard.current = false
          window.setTimeout(() => {
            if (!inCard.current && !hoveredRef.current) setShownId(null)
          }, CLOSE_DELAY_MS)
        }}
      >
        <div className="flex items-start gap-2.5">
          <CommentPin
            as="span"
            number={mark.number}
            color={markInk(mark)}
            proposed={mark.status === 'proposed'}
          />
          <div className="min-w-0 flex-1">
            <p className="text-foreground line-clamp-3 text-[13px] leading-5">
              <MarkBody text={mark.body} mentions={mark.mentions} viewerId={review.me} clamped />
            </p>
            <p className="text-muted-foreground mt-1 truncate text-xs">
              {[t(`annotations.kinds.${mark.kind}`), author, mark.replies.length > 0 ? t('annotations.replies', { count: mark.replies.length }) : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3 h-8 w-full gap-1.5"
          data-testid="inline-mark-peek-open"
          onClick={() => {
            setShownId(null)
            onOpenMark(mark.id)
          }}
        >
          <ScanEye className="size-3.5" aria-hidden />
          {t('annotations.openInReview')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
