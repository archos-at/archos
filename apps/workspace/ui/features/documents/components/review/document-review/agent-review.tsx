'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { RotateCcw, Sparkles, X } from 'lucide-react'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { Button } from '@/components/ui/button'
import { ShimmerText } from '@/components/ui/shimmer-text'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { liveLine } from '@/features/chat'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { filesCopy } from '@/i18n/namespaces/files'
import { stepsOf } from '../../../hooks/use-canvas-ask'
import type { DocumentReview as ReviewState } from '../../../hooks/use-document-review'
import { documentReviewOf } from '../../../lib/document-review-ask'

export function AgentReview({ review, onWalk }: { review: ReviewState; onWalk: () => void }): JSX.Element {
  const t = useTranslations(filesCopy)
  const tChat = useTranslations(chatCopy)
  const { piloti: agent } = review
  const run = documentReviewOf(agent.asks)
  if (!run) {
    const button = (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 gap-1.5"
        data-testid="review-with-agent"
        disabled={agent.busy}
        onClick={() => agent.ask({ text: t('review.reviewSeed'), region: null, effort: 'medium' })}
      >
        <Sparkles className="size-3.5" aria-hidden />
        {/* On a phone the glyph carries it; the words stay for a screen reader. */}
        <span className="max-sm:sr-only">{t('review.reviewWithAgent')}</span>
      </Button>
    )
    if (!agent.busy) return button
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
      className="border-border/70 bg-muted flex h-8 max-w-[30rem] items-center gap-2 rounded-full border pr-1 pl-1"
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
          size="sm"
          className="h-6 shrink-0 rounded-full px-2.5 text-xs"
          data-testid="review-agent-walk"
          onClick={onWalk}
        >
          {t('review.walkProposals')}
        </Button>
      )}
      {agent.conversationHref && (
        <Button asChild variant="ghost" size="sm" className="h-6 px-2 text-xs">
          <Link href={agent.conversationHref} data-testid="review-agent-conversation">
            {t('review.piloti.openConversation')}
          </Link>
        </Button>
      )}
      {run.status === 'failed' && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 rounded-full [&_svg]:size-3"
          aria-label={t('review.piloti.retry')}
          onClick={() => agent.retry(run.id)}
        >
          <RotateCcw aria-hidden />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 rounded-full [&_svg]:size-3"
        aria-label={working ? t('review.piloti.stop') : t('review.piloti.close')}
        title={working ? t('review.piloti.stop') : t('review.piloti.close')}
        data-testid="review-agent-dismiss"
        onClick={() => agent.dismiss(run.id)}
      >
        <X aria-hidden />
      </Button>
    </div>
  )
}
