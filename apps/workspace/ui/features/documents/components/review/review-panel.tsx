'use client'

import { memo, useState, type JSX } from 'react'
import { useMediaQuery } from '@/hooks/use-media-query'
import { CheckCheck, ChevronDown, Clock, GitCompare, History, MousePointerClick, Sparkles, UserRound } from 'lucide-react'
import NextLink from 'next/link'
import { Button } from '@/components/ui/button'
import { CommentPin } from '@/components/ui/comment-pin'
import { Spinner } from '@/components/ui/spinner'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { formatDayRange } from '@/lib/format'
import { isForReader, isLive, type AnnotationView, type CarryTargetView } from '@/lib/annotations/types'
import type { RevisionRef } from '@/lib/documents/revision-links'
import { cn } from '@/lib/utils'
import type { CarriedGroup, DocumentReview, ReviewFilter } from '../../hooks/use-document-review'
import { compareFromReviewHref } from '../../lib/revision-links'
import { MarkBody } from './mark-body'
import { MarkRowContent, markRowClassName } from './mark-row'
import { markInk } from './review-page-layer'

export type OpenMark = (annotation: AnnotationView, byKeyboard?: boolean) => void

export type CheckFixed = (marks: readonly AnnotationView[], from: RevisionRef | null) => void

function CheckFixedButton({
  review,
  marks,
  from,
  onCheckFixed,
}: {
  review: DocumentReview
  marks: readonly AnnotationView[]
  from: RevisionRef | null
  onCheckFixed: CheckFixed
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const target = from?.id ?? review.documentId
  const running = review.piloti.asks.some(
    (ask) => ask.status === 'thinking' && ask.checkFixed?.documentId === target
  )
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 gap-1 px-2 text-xs"
      disabled={review.piloti.busy}
      data-testid={from ? 'review-check-fixed-from' : 'review-check-fixed-earlier'}
      onClick={() => onCheckFixed(marks, from)}
    >
      {running ? <Spinner size="sm" /> : <Sparkles className="size-3" aria-hidden />}
      {running ? t('review.checkFixed.running') : t('review.checkFixed.action')}
    </Button>
  )
}

const Row = memo(function Row({
  annotation,
  viewerId,
  selected,
  unread,
  onHover,
  onOpen,
}: {
  annotation: AnnotationView
  viewerId: string | null
  selected: boolean
  unread: boolean
  onHover: (annotationId: string | null) => void
  onOpen: OpenMark
}): JSX.Element {
  return (
    <li>
      <button data-attr="review-row"
        type="button"
        data-testid="review-row"
        aria-current={selected || undefined}
        onClick={(event) => onOpen(annotation, event.detail === 0)}
        onPointerEnter={() => onHover(annotation.id)}
        onPointerLeave={() => onHover(null)}
        className={markRowClassName(selected)}
      >
        <MarkRowContent annotation={annotation} viewerId={viewerId} unread={unread} />
      </button>
    </li>
  )
})

function Pages({
  marks,
  review,
  onOpen,
}: {
  marks: readonly AnnotationView[]
  review: DocumentReview
  onOpen: OpenMark
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const pages = [...new Set(marks.map((annotation) => annotation.page))]
  const headed = new Set(review.annotations.map((annotation) => annotation.page)).size > 1
  return (
    <>
      {pages.map((page) => (
        <section key={page} aria-label={t('review.page', { page })}>
          {headed && (
            <h3 className="text-muted-foreground px-2.5 pt-3 pb-1 text-[11px] font-medium">
              {t('review.page', { page })}
            </h3>
          )}
          <ul className="space-y-0.5">
            {marks
              .filter((annotation) => annotation.page === page)
              .map((annotation) => (
                <Row
                  key={annotation.id}
                  annotation={annotation}
                  viewerId={review.me}
                  selected={annotation.id === review.selectedId}
                  unread={review.unread.has(annotation.id) && annotation.id !== review.selectedId}
                  onHover={review.hover}
                  onOpen={onOpen}
                />
              ))}
          </ul>
        </section>
      ))}
    </>
  )
}

function useCarrying(review: DocumentReview) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const carry = async (marks: readonly AnnotationView[]) => {
    setBusy(true)
    setFailed(false)
    const { failed: missed } = await review.carryAll(marks)
    setFailed(missed > 0)
    setBusy(false)
  }
  return { busy, failed, carry }
}

function EarlierBar({ review, onCheckFixed }: { review: DocumentReview; onCheckFixed?: CheckFixed }): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const { busy, failed, carry } = useCarrying(review)
  const marks = review.annotations.filter((annotation) => !annotation.onCurrentRevision && annotation.carryTarget)
  if (marks.length === 0) return null
  return (
    <div className="bg-muted mx-0.5 mb-2 space-y-1 rounded-surface px-2.5 py-2" data-testid="review-earlier-bar">
      <div className="flex items-center gap-2">
        <History className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <span className="text-foreground min-w-0 flex-1 text-xs font-medium">{t('review.earlierOpen', { count: marks.length })}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={busy}
          data-testid="review-carry-all-earlier"
          onClick={() => void carry(marks)}
        >
          {t('review.carryAll')}
        </Button>
      </div>
      {onCheckFixed && <CheckFixedButton review={review} marks={marks} from={null} onCheckFixed={onCheckFixed} />}
      {failed && <p className="text-destructive text-[11px] leading-4">{t('review.carryFailed')}</p>}
    </div>
  )
}

function CarriedFrom({
  review,
  group,
  onCheckFixed,
}: {
  review: DocumentReview
  group: CarriedGroup
  onCheckFixed?: CheckFixed
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const { busy, failed, carry } = useCarrying(review)
  const [resolveFailed, setResolveFailed] = useState(false)
  const resolve = async (annotation: AnnotationView) => {
    setResolveFailed(false)
    await review.resolveCarried(annotation).catch(() => setResolveFailed(true))
  }
  const carryable = group.annotations.filter((annotation) => annotation.carryTarget)
  const carryWords = (annotation: AnnotationView, target: CarryTargetView) =>
    target.documentId === review.documentId
      ? { label: t('review.carry'), aria: t('review.carryMark', { number: annotation.number }) }
      : {
          label: t('review.carryTo', { name: target.documentName }),
          aria: t('review.carryMarkTo', { number: annotation.number, name: target.documentName }),
        }
  const compare =
    typeof window === 'undefined' ? null : compareFromReviewHref(window.location, review.documentId, group.from.id)
  return (
    <section
      data-testid="review-carried-group"
      aria-label={t('review.carriedGroup', { name: group.from.filename })}
      className="mx-0.5 mb-2 rounded-surface border"
    >
      <div className="space-y-1 px-2.5 pt-2 pb-1">
        <div className="flex items-center gap-2">
          <History className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          <h3 className="text-foreground min-w-0 flex-1 truncate text-xs font-medium">
            {t('review.carriedGroup', { name: group.from.filename })}
          </h3>
          {carryable.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={busy}
              data-testid="review-carry-all-from"
              onClick={() => void carry(carryable)}
            >
              {t('review.carryAll')}
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-[11px] leading-4">{t('review.carriedGroupHint', { name: group.from.filename })}</p>
        {onCheckFixed && carryable.length > 0 && (
          <CheckFixedButton review={review} marks={carryable} from={group.from} onCheckFixed={onCheckFixed} />
        )}
        {compare && (
          <NextLink
            href={compare}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px] underline underline-offset-2"
            data-testid="review-compare-revisions"
          >
            <GitCompare className="size-3" aria-hidden />
            {t('review.compareRevisions')}
          </NextLink>
        )}
      </div>
      {group.load === 'error' && (
        <div className="space-y-2 px-2.5 pb-2" data-testid="review-carried-error">
          <p className="text-muted-foreground text-[11px] leading-4">
            {t('review.carriedLoadError', { name: group.from.filename })}
          </p>
          <Button type="button" variant="secondary" size="sm" className="h-7 text-xs" onClick={review.retryCarried}>
            {t('annotations.retry')}
          </Button>
        </div>
      )}
      <ul className="space-y-0.5 px-0.5 pb-1">
        {group.annotations.map((annotation) => (
          <li key={annotation.id} className="flex gap-3 rounded-control px-2.5 py-2" data-testid="review-carried-row">
            <span className="pt-0.5">
              <CommentPin as="span" number={annotation.number} color={markInk(annotation)} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-foreground line-clamp-2 text-sm leading-5">
                <MarkBody text={annotation.body} mentions={annotation.mentions} viewerId={review.me} clamped />
              </span>
              <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
                <span className="whitespace-nowrap">{t(`annotations.kinds.${annotation.kind}`)}</span>
                {t('review.page', { page: annotation.page })}
                {annotation.assigneeName && (
                  <span className="inline-flex min-w-0 items-center gap-0.5 whitespace-nowrap">
                    <UserRound className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{annotation.assigneeName}</span>
                  </span>
                )}
                {annotation.dueOn && (
                  <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
                    <Clock className="size-3" aria-hidden />
                    {formatDayRange(annotation.dueOn, annotation.dueOn, locale)}
                  </span>
                )}
              </span>
              <AgentVerdict annotation={annotation} viewerId={review.me} />
              {annotation.carryTarget && (
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={busy}
                    data-testid="review-carry-from"
                    aria-label={carryWords(annotation, annotation.carryTarget).aria}
                    onClick={() => void carry([annotation])}
                  >
                    {carryWords(annotation, annotation.carryTarget).label}
                  </Button>
                  {/* Fixed in this document: closed where it was set, by the person, never by Piloti. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={busy}
                    data-testid="review-resolve-from"
                    aria-label={t('review.checkFixed.resolveMark', { number: annotation.number, name: group.from.filename })}
                    onClick={() => void resolve(annotation)}
                  >
                    {t('review.checkFixed.resolve')}
                  </Button>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {failed && <p className="text-destructive px-2.5 pb-2 text-[11px] leading-4">{t('review.carryFailed')}</p>}
      {resolveFailed && (
        <p className="text-destructive px-2.5 pb-2 text-[11px] leading-4">{t('review.checkFixed.resolveFailed')}</p>
      )}
    </section>
  )
}

function AgentVerdict({ annotation, viewerId }: { annotation: AnnotationView; viewerId: string | null }): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const newest = annotation.replies.at(-1)
  if (newest?.authorKind !== 'piloti') return null
  return (
    <span className="text-muted-foreground mt-1 flex gap-1 text-xs leading-4" data-testid="review-carried-verdict">
      <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span className="line-clamp-3 min-w-0">
        <span className="sr-only">{t('review.checkFixed.verdict')}: </span>
        <MarkBody text={newest.body} mentions={newest.mentions} viewerId={viewerId} clamped />
      </span>
    </span>
  )
}

const FILTERS: ReviewFilter[] = ['open', 'closed']

export function tabCounts(
  annotations: readonly Pick<AnnotationView, 'status' | 'assigneeUserId'>[],
  mine: { on: boolean; me: string | null }
): Record<ReviewFilter | 'proposed', number> {
  const shown = mine.on ? annotations.filter((annotation) => isForReader(annotation, mine.me)) : annotations
  return {
    open: shown.filter((annotation) => annotation.status === 'open').length,
    proposed: shown.filter((annotation) => annotation.status === 'proposed').length,
    closed: shown.filter((annotation) => !isLive(annotation)).length,
  }
}

export function ReviewPanel({
  review,
  onOpen,
  onWalkProposals,
  onCheckFixed,
  presentation = 'rail',
}: {
  review: DocumentReview
  onOpen: OpenMark
  onWalkProposals?: () => void
  onCheckFixed?: CheckFixed
  presentation?: 'rail' | 'sheet'
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { listed, filter, setFilter, load, mine, setMine } = review
  const counts = tabCounts(review.annotations, { on: mine, me: review.me })
  const [proposalsOpen, setProposalsOpen] = useState(true)
  const proposals = filter === 'open' ? listed.filter((annotation) => annotation.status === 'proposed') : []
  const rest = listed.filter((annotation) => !proposals.includes(annotation))

  return (
    <aside
      data-testid="review-panel"
      aria-label={t('annotations.section')}
      className={cn(
        'bg-background flex flex-col',
        presentation === 'rail' ? 'h-full w-[22rem] shrink-0 border-l max-lg:hidden' : 'min-h-0 flex-1',
      )}
    >
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        {/* Two buttons that say which is on, not a tab list: there is no tab panel, and Tab reaches each. */}
        <div role="group" aria-label={t('review.filter')} className="bg-muted inline-flex rounded-control p-0.5">
          {FILTERS.map((option) => {
            const count = counts[option]
            return (
              <button data-attr="files-filter"
                key={option}
                type="button"
                aria-pressed={filter === option}
                data-testid={`review-filter-${option}`}
                onClick={() => setFilter(option)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors duration-quick ease-out pointer-coarse:h-10',
                  filter === option ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t(`review.filters.${option}`)}
                {count > 0 && <span className="text-muted-foreground tabular-nums">{count}</span>}
                {option === 'open' && counts.proposed > 0 && (
                  <span className="text-muted-foreground" data-testid="review-filter-open-proposed">
                    · {t('annotations.listedProposedShort', { count: counts.proposed })}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <button data-attr="review-filter-mine"
          type="button"
          aria-pressed={mine}
          data-testid="review-filter-mine"
          onClick={() => setMine(!mine)}
          className={cn(
            'ml-auto inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors duration-quick ease-out pointer-coarse:h-11 pointer-coarse:px-3.5',
            mine ? 'bg-foreground text-background border-transparent' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t('review.mine')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {load === 'loading' ? (
          <div className="flex justify-center py-10">
            <Spinner size="sm" />
          </div>
        ) : load === 'error' ? (
          <div className="space-y-2 px-2 py-6 text-center">
            <p className="text-muted-foreground text-sm">{t('annotations.loadError')}</p>
            <Button type="button" variant="secondary" size="sm" onClick={review.retry}>
              {t('annotations.retry')}
            </Button>
          </div>
        ) : (
          <>
            {filter === 'open' &&
              review.carried.map((group) => (
                <CarriedFrom key={group.from.id} review={review} group={group} onCheckFixed={onCheckFixed} />
              ))}
            {filter === 'open' && <EarlierBar review={review} onCheckFixed={onCheckFixed} />}
            {listed.length === 0 ? (
              <EmptyList review={review} />
            ) : (
              <ListedMarks
                review={review}
                proposals={proposals}
                rest={rest}
                proposalsOpen={proposalsOpen}
                setProposalsOpen={setProposalsOpen}
                onOpen={onOpen}
                onWalkProposals={onWalkProposals}
              />
            )}
          </>
        )}
      </div>
    </aside>
  )
}

function ListedMarks({
  review,
  proposals,
  rest,
  proposalsOpen,
  setProposalsOpen,
  onOpen,
  onWalkProposals,
}: {
  review: DocumentReview
  proposals: readonly AnnotationView[]
  rest: readonly AnnotationView[]
  proposalsOpen: boolean
  setProposalsOpen: (update: (open: boolean) => boolean) => void
  onOpen: OpenMark
  onWalkProposals?: () => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <>
      {proposals.length > 0 && (
        <section
          data-testid="review-proposals"
          className="border-foreground/25 mx-0.5 mb-2 rounded-surface border border-dashed"
        >
          <div className="flex items-center gap-2 px-2.5 py-2">
            <button data-attr="files-proposals-open"
              type="button"
              aria-expanded={proposalsOpen}
              onClick={() => setProposalsOpen((open) => !open)}
              className="text-foreground flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium"
            >
              <Sparkles className="size-3.5" aria-hidden />
              {t('review.proposalsGroup', { count: proposals.length })}
              <ChevronDown
                className={cn('text-muted-foreground size-3.5 transition-transform duration-quick', !proposalsOpen && '-rotate-90')}
                aria-hidden
              />
            </button>
            {onWalkProposals && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                data-testid="review-walk-proposals"
                onClick={onWalkProposals}
              >
                {t('review.walkProposals')}
              </Button>
            )}
          </div>
          {proposalsOpen && (
            <div className="px-0.5 pb-1">
              <Pages marks={proposals} review={review} onOpen={onOpen} />
              <p className="text-muted-foreground px-2.5 pt-1 pb-1.5 text-[11px] leading-4" data-testid="review-proposals-legend">
                {t('review.proposalsLegend')}
              </p>
            </div>
          )}
        </section>
      )}
      <Pages marks={rest} review={review} onOpen={onOpen} />
    </>
  )
}

function EmptyList({ review }: { review: DocumentReview }): JSX.Element {
  const t = useTranslations(filesCopy)
  const { counts, filter, annotations, mine } = review
  const touch = useMediaQuery('(pointer: coarse)')
  const allDone = filter === 'open' && !mine && annotations.length > 0 && counts.open + counts.proposed === 0
  const Icon = allDone ? CheckCheck : MousePointerClick
  const key = mine
    ? 'mine'
    : allDone
      ? 'done'
      : annotations.length === 0
        ? review.canAnnotate
          ? 'none'
          : 'readOnly'
        : filter
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" data-testid="review-empty">
      <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-foreground mt-3 text-sm font-medium">{t(`review.empty.${key}Title`)}</p>
      <p className="text-muted-foreground mt-1 text-xs leading-5">
        {key === 'none' && touch ? t('review.empty.noneBodyTouch') : t(`review.empty.${key}Body`)}
      </p>
    </div>
  )
}
