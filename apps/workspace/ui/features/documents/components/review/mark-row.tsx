'use client'

import type { JSX } from 'react'
import { Clock, MessageCircle, UserRound } from 'lucide-react'
import { CommentPin } from '@/components/ui/comment-pin'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { formatCalendarDay, localCalendarDay } from '@/lib/format'
import { isForReader, isLive, isOverdue, type AnnotationView } from '@/lib/annotations/types'
import { cn } from '@/lib/utils'
import { MarkBody } from './mark-body'
import { useAgentByline } from './agent-attribution'
import { markInk, pinLabel } from './review-page-layer'

/**
 * The surface of one mark's row: the review's list (a button) and a project's
 * Offene Punkte (a link into that review) both wear it, so a row reads the
 * same wherever a mark is listed.
 */
export const markRowClassName = (selected = false): string =>
  cn(
    'flex w-full gap-3 rounded-control px-2.5 py-2.5 text-left transition-colors duration-quick ease-out outline-none',
    'hover:bg-accent focus-visible:ring-ring/60 focus-visible:ring-2',
    selected && 'bg-accent'
  )

/** The two rings of a point on Offene Punkte: ink, and ochre where it needs the reader. Paper ink: the pin's face stays white. */
const VERDICT_RING = { ink: 'var(--paper-ink)', needsYou: 'var(--text-color-feedback-warning)' } as const

/**
 * What a row says about one mark: its number (what people say aloud), what it
 * says, and one quiet line of what kind, who, how many answers, by when, and
 * the Fassung it was set on when that is an earlier one. The row's
 * element (a button, a link) is the caller's.
 */
export function MarkRowContent({
  annotation,
  viewerId,
  showPage = false,
  unread = false,
  marker = 'author',
}: {
  annotation: AnnotationView
  /** The reader, so a mention of them stands out. */
  viewerId: string | null
  /** Name the page in the quiet line: where nothing around the row says which page it is on. */
  showPage?: boolean
  /** News on it the reader has not read (`DocumentReview.unread`): a dot on the pin, and words for a screen reader. */
  unread?: boolean
  /**
   * What the pin's ring says. `author` (the review, beside the page): whose mark it is, the colour of the pin on the
   * sheet, so the row and the pin are found as one. `verdict` (Offene Punkte, where no page is beside it): ink at 1.5px
   * for every point, ochre only for one assigned to the reader or overdue (paper on a desk, principle 7: colour is a
   * verdict). Who set it is then the name in the meta line.
   */
  marker?: 'author' | 'verdict'
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const byline = useAgentByline()
  const overdue = isOverdue(annotation, localCalendarDay())
  const needsReader = isLive(annotation) && (overdue || isForReader(annotation, viewerId))
  const author =
    annotation.authorKind === 'piloti' ? byline(annotation.createdByName) : (annotation.createdByName ?? t('review.someone'))
  return (
    <>
      <span className="pt-0.5" data-marker={marker === 'verdict' ? (needsReader ? 'needs-you' : 'ink') : undefined}>
        {/* The pin is drawn for the eye only (`aria-hidden`): its number and its
            state (a dash, a tick, the dot) are said here, as a pin on the page
            says them. Who set it and the Fassung are the row's own text. */}
        <span className="sr-only" data-testid="mark-row-label">
          {`${pinLabel(t, annotation, undefined, undefined, { unread })}. `}
        </span>
        <CommentPin
          as="span"
          number={annotation.number}
          color={marker === 'author' ? markInk(annotation) : needsReader ? VERDICT_RING.needsYou : VERDICT_RING.ink}
          className={cn(marker === 'verdict' && 'border-[1.5px] shadow-none')}
          proposed={annotation.status === 'proposed'}
          done={!isLive(annotation)}
          unread={unread}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('text-foreground line-clamp-2 text-sm leading-5', !isLive(annotation) && 'text-muted-foreground')}>
          <MarkBody text={annotation.body} mentions={annotation.mentions} viewerId={viewerId} clamped />
        </span>
        {/* Items apart by „·“ as every meta line of the surface (the tile's, the mail row's), the dot after an item
            so a wrapped line never starts with one; each item keeps to one line. 4px each side: a glyph clause's own
            2px gap counts toward its dot's margin. */}
        <span className="text-muted-foreground flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs [&>*:not(:last-child)]:after:ml-1 [&>.inline-flex:not(:last-child)]:after:ml-0.5 [&>*:not(:last-child)]:after:text-muted-foreground/40 [&>*:not(:last-child)]:after:content-['·']" data-testid="review-row-meta">
          <span className="whitespace-nowrap">{t(`annotations.kinds.${annotation.kind}`)}</span>
          {showPage && <span className="whitespace-nowrap">{t('review.page', { page: annotation.page })}</span>}
          <span className="min-w-0 truncate">{author}</span>
          {annotation.assigneeName && (
            <span className="inline-flex min-w-0 items-center gap-0.5 whitespace-nowrap">
              <UserRound className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{annotation.assigneeName}</span>
            </span>
          )}
          {annotation.replies.length > 0 && (
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
              <MessageCircle className="size-3" aria-hidden />
              {annotation.replies.length}
            </span>
          )}
          {annotation.dueOn && (
            <span className={cn('inline-flex items-center gap-0.5 whitespace-nowrap', overdue && 'text-warning font-medium' /* ochre with its clock and word: this one waits on a person */)}>
              <Clock className="size-3" aria-hidden />
              {overdue ? t('review.overdue') : formatCalendarDay(annotation.dueOn, locale)}
            </span>
          )}
          {/* The Fassung it was set on, when an earlier one: one more clause of the meta line, never a third line. */}
          {!annotation.onCurrentRevision && (
            <span className="whitespace-nowrap" title={t('annotations.earlierRevisionHint')} data-testid="mark-row-earlier-revision">
              {annotation.revisionNumber
                ? t('annotations.earlierRevision', { number: annotation.revisionNumber })
                : t('annotations.earlierRevisionUnnumbered')}
            </span>
          )}
        </span>
      </span>
    </>
  )
}
