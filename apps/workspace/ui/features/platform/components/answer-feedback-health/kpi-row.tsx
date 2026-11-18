'use client'

import type { JSX } from 'react'
import { Filter, Gauge, ThumbsDown, ThumbsUp, Users } from 'lucide-react'

import { StatCard } from '@/components/ui/stat-card'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { cn } from '@/lib/utils'
import { formatCount, MIN_RATE_VOTES, type FeedbackHealthResponse } from '../answer-feedback-types'

export function KpiRow({
  data,
  narrowed,
  locale,
  className,
}: {
  data: FeedbackHealthResponse
  narrowed: boolean
  locale: string
  className?: string
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const total = data.totals.up + data.totals.down
  const rateReadable = total >= MIN_RATE_VOTES
  const helpfulRate = total > 0 ? (data.totals.up / total) * 100 : 0
  const coverage =
    data.coverage !== undefined
      ? data.coverage === null
        ? null
        : Math.min(100, data.coverage * 100)
      : data.answers > 0
        ? Math.min(100, (total / data.answers) * 100)
        : null
  const percent = (value: number, decimals: number): string =>
    t('answerFeedback.percent', { value: formatCount(value, locale, decimals) })

  return (
    <div
      className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4', className)}
      data-testid="feedback-kpis"
    >
      {/* The headline is the HELPFUL share. A page whose biggest number is a
          failure rate can only ever report how much was lost. */}
      <StatCard
        icon={<ThumbsUp aria-hidden />}
        label={t('answerFeedback.kpi.helpfulLabel')}
        value={rateReadable ? percent(helpfulRate, 1) : '—'}
        data-testid="feedback-kpi-helpful"
        hint={
          <span className="flex flex-col gap-1">
            <span>
              {rateReadable
                ? t('answerFeedback.kpi.helpfulHint', {
                    up: formatCount(data.totals.up, locale),
                    total: formatCount(total, locale),
                  })
                : t('answerFeedback.kpi.helpfulTooFew', { min: MIN_RATE_VOTES })}
            </span>
            {/* Narrowed aggregates make the headline a claim about the
                selection; a big percentage with no such note ends up in a slide. */}
            {narrowed ? (
              <span className="text-warning inline-flex items-center gap-1 font-medium">
                <Filter className="size-3 shrink-0" aria-hidden />
                {t('answerFeedback.filteredNote')}
              </span>
            ) : null}
          </span>
        }
      />
      {/* The denominator, beside the headline: raters self-select, so the
          rate describes the people who voted. Coverage says how few they were. */}
      <StatCard
        icon={<Gauge aria-hidden />}
        label={t('answerFeedback.kpi.coverageLabel')}
        value={coverage === null ? '—' : percent(coverage, 1)}
        data-testid="feedback-kpi-coverage"
        hint={
          coverage === null
            ? t('answerFeedback.kpi.coverageNoAnswers')
            : t('answerFeedback.kpi.coverageHint', {
                votes: formatCount(total, locale),
                answers: formatCount(data.answers, locale),
              })
        }
      />
      {/* From how many PEOPLE: nineteen down-votes from three users and from
          nineteen produce the same rate and mean opposite things. */}
      <StatCard
        icon={<ThumbsDown aria-hidden />}
        label={t('answerFeedback.kpi.downLabel')}
        value={formatCount(data.totals.down, locale)}
        data-testid="feedback-kpi-down"
        hint={t('answerFeedback.kpi.downHint', {
          voters: formatCount(data.totals.downVoters, locale),
        })}
      />
      <StatCard
        icon={<Users aria-hidden />}
        label={t('answerFeedback.kpi.votersLabel')}
        value={formatCount(data.totals.voters, locale)}
        data-testid="feedback-kpi-voters"
        hint={t('answerFeedback.kpi.votersHint')}
      />
    </div>
  )
}
