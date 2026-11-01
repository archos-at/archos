'use client'

/**
 * The review's header: the document's name, its Fassung and what it replaces,
 * the open marks, who is here, the way out to a window of its own, the list on
 * a narrow screen, the Protokoll and „Piloti prüfen lassen“. The same for every
 * document; a stage adds its own controls into `stageSlot` (a Skizze's save).
 */

import type { JSX, ReactNode } from 'react'
import Link from 'next/link'
import { ExternalLink, Link2, MessagesSquare, RotateCcw, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { ShimmerText } from '@/components/ui/shimmer-text'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { liveLine } from '@/features/chat/lib/turn-events'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { filesCopy } from '@/i18n/namespaces/files'
import { stepsOf, type CanvasAsk } from '../../hooks/use-canvas-ask'
import type { DocumentReview as ReviewState } from '../../hooks/use-document-review'
import { hasLiveMarks, openMarksLabel, openMarksShortLabel } from '../open-marks-chip'
import { Presence } from './presence'

/** The whole-document review asked of Piloti: the latest one, while it is in the header. */
const documentReviewOf = (asks: readonly CanvasAsk[]): CanvasAsk | null =>
  asks.findLast((ask) => ask.region === null && !ask.replyInThread) ?? null

/**
 * „Piloti prüfen lassen" in place: Piloti goes through the document while it
 * stays open, its findings landing as proposals through the room, its pointer
 * on the pages. The header says what it is doing, compactly, and where the
 * conversation is.
 */
function AgentReview({ review, onWalk }: { review: ReviewState; onWalk: () => void }): JSX.Element {
  const t = useTranslations(filesCopy)
  const tChat = useTranslations(chatCopy)
  const { piloti } = review
  const run = documentReviewOf(piloti.asks)
  if (!run) {
    const button = (
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="review-with-agent"
        disabled={piloti.busy}
        onClick={() => piloti.ask({ text: t('review.reviewSeed'), region: null, effort: 'medium' })}
      >
        <Sparkles className="size-3.5" aria-hidden />
        {/* On a phone the glyph carries it; the words stay for a screen reader. */}
        <span className="max-sm:sr-only">{t('review.reviewWithAgent')}</span>
      </Button>
    )
    if (!piloti.busy) return button
    // A disabled button says why: a wrapper takes the pointer the button no longer does.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-control" data-testid="review-with-agent-busy">
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('review.piloti.busyTooltip')}</TooltipContent>
      </Tooltip>
    )
  }
  const working = run.status === 'thinking'
  // A check of what is fixed answers in the threads: it finds no proposals to walk.
  const checking = run.checkFixed !== null
  const found = run.status === 'answered' && !checking ? review.counts.proposed : 0
  const line = working
    ? (liveLine(stepsOf(run.view), tChat) ?? t(checking ? 'review.piloti.checkingFixed' : 'review.piloti.reviewing'))
    : run.status === 'failed'
      ? t('review.piloti.reviewFailed')
      : found > 0
        ? t('review.piloti.reviewFound', { count: found })
        : t(checking ? 'review.piloti.checkFixedDone' : 'review.piloti.reviewDone')
  return (
    <div
      role="status"
      data-testid="review-agent-status"
      className="border-border/70 bg-muted/40 flex h-8 max-w-[30rem] items-center gap-2 rounded-control border pr-0.5 pl-1.5"
    >
      <AgentGlyph working={working} />
      {working ? (
        <ShimmerText className="min-w-0 flex-1 text-xs">{line}</ShimmerText>
      ) : (
        <span className="text-foreground min-w-0 flex-1 truncate text-xs font-medium">{line}</span>
      )}
      {found > 0 && (
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className="shrink-0"
          data-testid="review-agent-walk"
          onClick={onWalk}
        >
          {t('review.walkProposals')}
        </Button>
      )}
      {piloti.conversationHref && (
        <Button asChild variant="ghost" size="xs" className="shrink-0">
          <Link href={piloti.conversationHref} data-testid="review-agent-conversation">
            {t('review.piloti.openConversation')}
          </Link>
        </Button>
      )}
      {run.status === 'failed' && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('review.piloti.retry')}
          onClick={() => piloti.retry(run.id)}
        >
          <RotateCcw aria-hidden />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={working ? t('review.piloti.stop') : t('review.piloti.close')}
        title={working ? t('review.piloti.stop') : t('review.piloti.close')}
        data-testid="review-agent-dismiss"
        onClick={() => piloti.dismiss(run.id)}
      >
        <X aria-hidden />
      </Button>
    </div>
  )
}
export function ReviewHeader({
  review,
  documentName,
  revisionLabel,
  onClose,
  following,
  onFollow,
  pageMenu,
  popoutHref,
  onPopout,
  onCopyText,
  listBeside,
  listOpen,
  onListOpen,
  exportMenu,
  onWalk,
  stageSlot,
}: {
  review: ReviewState
  documentName: string
  revisionLabel?: string | null
  onClose: () => void
  following: string | null
  /** Following a face; absent where the stage has no view to follow (a Skizze). */
  onFollow?: (peerId: string | null) => void
  /** The page menu, where the content has pages. */
  pageMenu: ReactNode
  popoutHref: string | null
  onPopout: () => void
  onCopyText: (text: string) => void
  listBeside: boolean
  listOpen: boolean
  onListOpen: () => void
  exportMenu: ReactNode
  onWalk: () => void
  /** Where a stage puts its own controls: a Skizze's save and its status. */
  stageSlot?: (node: HTMLElement | null) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const { room, piloti } = review
  return (
    <header className="flex min-h-13 shrink-0 items-center gap-3 border-b px-3 pt-[env(safe-area-inset-top)] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] max-sm:flex-wrap max-sm:gap-x-2 max-sm:gap-y-0">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        aria-label={t('review.close')}
        title={`${t('review.close')} (Esc)`}
        onClick={onClose}
      >
        <X aria-hidden />
      </Button>
      {/* On a phone the name has a row of its own, under the close and the
          faces: beside them it kept ~40px, „G…_Index-C.pdf". Cut in the
          middle where even the row is short: the index at its end is what
          says which Fassung is under review. The line under it wraps there
          rather than lose the count. */}
      <div className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full max-sm:pb-2">
        <DialogTitle className="text-foreground flex text-sm font-semibold">
          <MiddleTruncate text={documentName} tail={12} />
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-xs sm:truncate">
          {[
            revisionLabel,
            // Another document replaces this one, or this one replaces another: the header says so.
            review.revision?.replacedBy
              ? t('review.replacedBy', { name: review.revision.replacedBy.filename })
              : review.revision?.replaces[0]
                ? t('review.replaces', { name: review.revision.replaces[0].filename })
                : null,
            // „2 offen · 12 Vorschläge": Piloti's untaken proposals are not counted as open, as in Dateien.
            hasLiveMarks(review.counts) ? openMarksShortLabel(t, review.counts) : t('review.nothingOpen'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </DialogDescription>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3 max-sm:gap-2">
        {room.status === 'offline' && (
          <span
            className="text-muted-foreground text-xs font-medium"
            data-testid="review-offline"
            title={t('review.offlineHint')}
            role="status"
          >
            {t('review.offline')}
          </span>
        )}
        <Presence review={review} following={following} onFollow={onFollow} />
        {pageMenu}
        {popoutHref && (
          // A window of its own for a second screen, and the link to send: both quiet, beside the faces.
          <span className="flex items-center max-sm:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('review.popout')}
              title={t('review.popout')}
              data-testid="review-popout"
              onClick={onPopout}
            >
              <ExternalLink aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('review.copyReviewLink')}
              title={t('review.copyReviewLink')}
              data-testid="review-copy-link"
              onClick={() => onCopyText(new URL(popoutHref, window.location.href).toString())}
            >
              <Link2 aria-hidden />
            </Button>
          </span>
        )}
        {!listBeside && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-haspopup="dialog"
            aria-expanded={listOpen}
            // „Anmerkungen: 3 offene Anmerkungen und 12 Vorschläge von Piloti“: the chip's sentence.
            aria-label={t('review.listOpen', {
              marks: hasLiveMarks(review.counts) ? openMarksLabel(t, locale, review.counts) : t('review.nothingOpen'),
            })}
            data-testid="review-list-open"
            onClick={onListOpen}
          >
            <MessagesSquare className="size-3.5" aria-hidden />
            {/* The open marks, as „offen“ counts them everywhere: Piloti's proposals are not the office's yet. */}
            <span className="font-mono tabular-nums">{review.counts.open}</span>
          </Button>
        )}
        {listBeside && exportMenu}
        {piloti.available && review.canAnnotate && <AgentReview review={review} onWalk={onWalk} />}
        {stageSlot && <div ref={stageSlot} className="contents" data-testid="review-stage-actions" />}
      </div>
    </header>
  )
}
