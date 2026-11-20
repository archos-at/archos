'use client'

import { type Dispatch, type JSX, type ReactNode, type SetStateAction } from 'react'
import { ExternalLink, Link2, MessagesSquare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { DocumentReview as ReviewState } from '../../../hooks/use-document-review'
import { hasLiveMarks, openMarksLabel, openMarksShortLabel } from '../../open-marks-chip'
import type { useReviewList } from '../review-list'
import { AgentReview } from './agent-review'
import { Presence } from './presence'

export function ReviewHeader({
  review,
  documentName,
  revisionLabel,
  close,
  following,
  setFollowing,
  popoutHref,
  popout,
  copyText,
  list,
  exportMenu,
  walkProposals,
  agentOffered,
}: {
  review: ReviewState
  documentName: string
  revisionLabel?: string | null
  close: () => void
  following: string | null
  setFollowing: Dispatch<SetStateAction<string | null>>
  popoutHref: string | null
  popout: () => void
  copyText: (text: string) => void
  list: ReturnType<typeof useReviewList>
  exportMenu: ReactNode
  walkProposals: () => void
  agentOffered: boolean
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const { room } = review
  const { beside: listBeside } = list
  return (
    <header className="flex min-h-13 shrink-0 items-center gap-3 border-b px-3 pt-[env(safe-area-inset-top)] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] max-sm:flex-wrap max-sm:gap-x-2 max-sm:gap-y-0">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 pointer-coarse:size-11"
        aria-label={t('review.close')}
        title={`${t('review.close')} (Esc)`}
        onClick={close}
      >
        <X className="size-4" aria-hidden />
      </Button>
      {/* On a phone the name has a row of its own, under the close and the
          faces: beside them it kept ~40px, „G…_Index-C.pdf". Cut in the
          middle where even the row is short: the index at its end is what
          says which Fassung is under review. The line under it wraps there
          rather than lose the count. */}
      <div className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full max-sm:pb-2">
        <DialogTitle className="text-foreground flex text-sm font-medium">
          <MiddleTruncate text={documentName} tail={12} />
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-xs sm:truncate">
          {[
            revisionLabel,
            review.revision?.replacedBy
              ? t('review.replacedBy', { name: review.revision.replacedBy.filename })
              : review.revision?.replaces[0]
                ? t('review.replaces', { name: review.revision.replaces[0].filename })
                : null,
            hasLiveMarks(review.counts) ? openMarksShortLabel(t, review.counts) : t('review.nothingOpen'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </DialogDescription>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3 max-sm:gap-2">
        {room.status === 'offline' && (
          <span
            className="text-muted-foreground text-[11px] font-medium"
            data-testid="review-offline"
            title={t('review.offlineHint')}
            role="status"
          >
            {t('review.offline')}
          </span>
        )}
        <Presence review={review} following={following} onFollow={setFollowing} />
        {popoutHref && (
          <span className="flex items-center max-sm:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t('review.popout')}
              title={t('review.popout')}
              data-testid="review-popout"
              onClick={popout}
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t('review.copyReviewLink')}
              title={t('review.copyReviewLink')}
              data-testid="review-copy-link"
              onClick={() => copyText(new URL(popoutHref, window.location.href).toString())}
            >
              <Link2 className="size-3.5" aria-hidden />
            </Button>
          </span>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 gap-1.5 pointer-coarse:h-11"
          aria-haspopup={listBeside ? undefined : 'dialog'}
          aria-expanded={list.expanded}
          aria-label={t('review.listOpen', {
            marks: hasLiveMarks(review.counts) ? openMarksLabel(t, locale, review.counts) : t('review.nothingOpen'),
          })}
          data-testid="review-list-open"
          onClick={list.toggle}
        >
          <MessagesSquare className="size-3.5" aria-hidden />
          {/* The open marks, as „offen“ counts them everywhere: the agent's proposals are not the office's yet. */}
          <span className="font-mono tabular-nums">{review.counts.open}</span>
        </Button>
        {listBeside && exportMenu}
        {agentOffered && <AgentReview review={review} onWalk={walkProposals} />}
      </div>
    </header>
  )
}
