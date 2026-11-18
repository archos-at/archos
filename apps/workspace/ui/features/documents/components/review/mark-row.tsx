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
import { isAgentKind } from '@/lib/agent-kind'

export const markRowClassName = (selected = false): string =>
  cn(
    'flex w-full gap-3 rounded-control px-2.5 py-2.5 text-left transition-colors duration-quick ease-out outline-none',
    'hover:bg-hover focus-visible:ring-ring/60 focus-visible:ring-2',
    selected && 'bg-selected hover:bg-selected'
  )

const VERDICT_RING = { ink: 'var(--foreground)', needsYou: 'var(--text-color-feedback-warning)' } as const

const META_LINE =
  "text-muted-foreground flex min-w-0 items-center gap-x-1 text-xs [&>*:not(:last-child)]:after:ml-1 [&>.inline-flex:not(:last-child)]:after:ml-0.5 [&>*:not(:last-child)]:after:text-muted-foreground/40 [&>*:not(:last-child)]:after:content-['·']"

export function MarkRowContent({
  annotation,
  viewerId,
  showPage = false,
  unread = false,
  marker = 'author',
  columns = false,
}: {
  annotation: AnnotationView
  viewerId: string | null
  showPage?: boolean
  unread?: boolean
  marker?: 'author' | 'verdict'
  columns?: boolean
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const byline = useAgentByline()
  const overdue = isOverdue(annotation, localCalendarDay())
  const needsReader = isLive(annotation) && (overdue || isForReader(annotation, viewerId))
  const author =
    isAgentKind(annotation.authorKind) ? byline(annotation.createdByName) : (annotation.createdByName ?? t('review.someone'))
  const who = annotation.assigneeName ? (
    <span className="inline-flex min-w-0 items-center gap-0.5 whitespace-nowrap" data-testid="mark-row-assignee">
      <UserRound className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{annotation.assigneeName}</span>
    </span>
  ) : null
  const due = annotation.dueOn ? (
    <span className={cn('inline-flex items-center gap-0.5 whitespace-nowrap', overdue && 'text-warning font-medium' /* ochre with its clock and word: this one waits on a person */)}>
      <Clock className="size-3" aria-hidden />
      {overdue ? t('review.overdue') : formatCalendarDay(annotation.dueOn, locale)}
    </span>
  ) : null
  const kind = <span className="whitespace-nowrap">{t(`annotations.kinds.${annotation.kind}`)}</span>
  const page = showPage ? <span className="whitespace-nowrap">{t('review.page', { page: annotation.page })}</span> : null
  const setBy = <span className="min-w-0 truncate">{author}</span>
  const replies =
    annotation.replies.length > 0 ? (
      <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
        <MessageCircle className="size-3" aria-hidden />
        {annotation.replies.length}
      </span>
    ) : null
  const revision = annotation.onCurrentRevision ? null : (
    <span className="whitespace-nowrap" title={t('annotations.earlierRevisionHint')} data-testid="mark-row-earlier-revision">
      {annotation.revisionNumber ? t('annotations.earlierRevision', { number: annotation.revisionNumber }) : t('annotations.earlierRevisionUnnumbered')}
    </span>
  )
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
          className={cn(marker === 'verdict' && 'bg-sheet text-foreground shadow-none', marker === 'verdict' && !needsReader && 'border-[1.5px]')}
          proposed={annotation.status === 'proposed'}
          done={!isLive(annotation)}
          unread={unread}
        />
      </span>
      <span className={cn('min-w-0 flex-1', columns && 'max-w-[720px]' /* a measure, not the 1216px column */)}>
        <span className={cn('text-foreground line-clamp-2 text-sm leading-5', !isLive(annotation) && 'text-muted-foreground')}>
          <MarkBody text={annotation.body} mentions={annotation.mentions} viewerId={viewerId} clamped />
        </span>
        {/* Items apart by „·“ as every meta line of the surface (the tile's, the mail row's), the dot after an item
            so a wrapped line never starts with one; each item keeps to one line. 4px each side: a glyph clause's own
            2px gap counts toward its dot's margin. In columns (Offene Punkte) the line does not wrap at all: who has
            it and by when stand in their own column at desk width, and a phone has a line of its own (below), so a
            line never ends on a dot (round 3: „Bernd Huber ·“ at a line's end, four-line rows). */}
        <span className={cn(META_LINE, columns ? 'flex-nowrap overflow-hidden max-sm:hidden' : 'flex-wrap gap-y-0.5')} data-testid="review-row-meta">
          {kind}
          {page}
          {setBy}
          {!columns && who}
          {replies}
          {!columns && due}
          {revision}
        </span>
        {/* On a phone one meta line that never wraps: what, where, who has it and by when (who set it only when nobody
            has it); the replies and the author are in the review. */}
        {columns && (
          <span className={cn(META_LINE, 'flex-nowrap overflow-hidden sm:hidden')} data-testid="review-row-meta-phone">
            {kind}
            {page}
            {who || due ? null : setBy}
            {who}
            {due}
            {revision}
          </span>
        )}
      </span>
      {/* At desk width who and by when are a column on the list's right edge, one place for the eye to run down. */}
      {columns && (
        <span className="text-muted-foreground ml-auto hidden shrink-0 items-start gap-4 pt-0.5 text-xs leading-5 sm:flex" data-testid="review-row-columns">
          <span className="flex w-36 min-w-0 justify-start">{who}</span>
          <span className="flex w-24 justify-end">{due}</span>
        </span>
      )}
    </>
  )
}
