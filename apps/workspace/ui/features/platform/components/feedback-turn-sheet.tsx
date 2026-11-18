'use client'

import type { JSX, ReactNode } from 'react'
import { ExternalLink, ThumbsDown, ThumbsUp } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SectionLabel } from '@/components/ui/section-label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { formatAbsoluteTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Quote } from '@/components/ui/quote'
import { orgLabel, type FeedbackHealthTurn } from './answer-feedback-types'

export function FeedbackVerdictBadge({
  turn,
}: {
  turn: Pick<FeedbackHealthTurn, 'verdict' | 'reason'>
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const landed = turn.verdict === 'up'
  return (
    <Badge variant={landed ? 'success' : 'warning'} data-testid="feedback-verdict">
      {landed ? <ThumbsUp aria-hidden /> : <ThumbsDown aria-hidden />}
      {landed
        ? t('answerFeedback.landedChip')
        : t(`answerFeedback.reasons.${turn.reason ?? 'other'}`)}
    </Badge>
  )
}

export interface FeedbackTurnSheetProps {
  turn: FeedbackHealthTurn | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FeedbackTurnSheet({
  turn,
  open,
  onOpenChange,
}: FeedbackTurnSheetProps): JSX.Element {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()

  return (
    <Sheet open={open && turn !== null} onOpenChange={onOpenChange}>
      <SheetContent
        className="sm:max-w-lg"
        closeLabel={t('answerFeedback.detail.close')}
        data-testid="feedback-turn-sheet"
      >
        {turn ? (
          <>
            <SheetHeader>
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                <FeedbackVerdictBadge turn={turn} />
                <TimeAgo date={turn.createdAt} locale={locale} />
              </div>
              <SheetTitle className="text-balance">
                {turn.conversationTitle?.trim() || t('answerFeedback.detail.title')}
              </SheetTitle>
              {/* The conversation is the title and the organization the line under
                  it; the facts list below does not repeat either. */}
              <SheetDescription
                className={cn(!turn.organizationName?.trim() && 'font-mono text-xs')}
              >
                {orgLabel(turn)}
              </SheetDescription>
            </SheetHeader>

            <DetailBlock label={t('answerFeedback.detail.question')}>
              {turn.question?.trim() ? (
                <p className="text-foreground whitespace-pre-wrap text-sm font-medium leading-relaxed">
                  {turn.question}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm italic">
                  {t('answerFeedback.turnUnavailable')}
                </p>
              )}
            </DetailBlock>

            <DetailBlock label={t('answerFeedback.detail.answer')}>
              {turn.answer?.trim() ? (
                <p className="text-foreground whitespace-pre-wrap text-sm leading-relaxed">
                  {turn.answer}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm italic">
                  {t('answerFeedback.detail.noAnswer')}
                </p>
              )}
            </DetailBlock>

            {turn.comment?.trim() ? (
              <DetailBlock
                label={t('answerFeedback.detail.comment')}
                quoted
                testId="feedback-turn-comment"
              >
                <p className="text-foreground whitespace-pre-wrap text-sm leading-relaxed">
                  {turn.comment}
                </p>
              </DetailBlock>
            ) : null}

            {turn.expectedAnswer?.trim() ? (
              <DetailBlock
                label={t('answerFeedback.detail.expected')}
                quoted
                testId="feedback-turn-expected"
              >
                <p className="text-foreground whitespace-pre-wrap text-sm leading-relaxed">
                  {turn.expectedAnswer}
                </p>
              </DetailBlock>
            ) : null}

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 border-t pt-4 text-sm">
              {turn.verdict === 'down' ? (
                <MetaRow label={t('answerFeedback.detail.reason')}>
                  {t(`answerFeedback.reasons.${turn.reason ?? 'other'}`)}
                </MetaRow>
              ) : null}
              <MetaRow label={t('answerFeedback.detail.ratedAt')}>
                <time dateTime={turn.createdAt} className="tabular-nums">
                  {formatAbsoluteTime(turn.createdAt, locale)}
                </time>
              </MetaRow>
            </dl>

            {turn.langfuseTraceUrl ? (
              <SheetFooter>
                <Button asChild variant="secondary">
                  <a href={turn.langfuseTraceUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden />
                    {t('answerFeedback.openInLangfuse')}
                  </a>
                </Button>
              </SheetFooter>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function DetailBlock({
  label,
  quoted = false,
  testId,
  children,
}: {
  label: string
  quoted?: boolean
  testId?: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className="flex flex-col gap-1.5" data-testid={testId}>
      <SectionLabel as="h3">{label}</SectionLabel>
      {quoted ? <Quote as="div">{children}</Quote> : <div>{children}</div>}
    </section>
  )
}

function MetaRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground min-w-0 break-words">{children}</dd>
    </>
  )
}
