'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { CONVERSATION_TAG_KEYS } from '@/lib/conversations/tags'
import { cn } from '@/lib/utils'
import {
  FEEDBACK_REASONS,
  formatCount,
  MIN_RATE_VOTES,
  orgLabel,
  type FeedbackReason,
} from '../answer-feedback-types'
import { FeedbackBarList, FeedbackBarRow } from '../feedback-bar-list'
import { SectionCard } from '../section-card'
import type { HealthContentProps } from './health-content-props'

export function ReasonsCard({
  data,
  filters,
  onReason,
  className,
}: HealthContentProps & { className?: string }): JSX.Element {
  const t = useTranslations(platformCopy)
  const bars = useMemo(() => {
    const counts = new Map<FeedbackReason, number>()
    for (const entry of data.reasons) {
      const key = entry.reason ?? 'other'
      counts.set(key, (counts.get(key) ?? 0) + entry.count)
    }
    const max = Math.max(1, ...FEEDBACK_REASONS.map((r) => counts.get(r) ?? 0))
    return FEEDBACK_REASONS.map((key) => ({
      key,
      count: counts.get(key) ?? 0,
      pct: ((counts.get(key) ?? 0) / max) * 100,
    }))
  }, [data.reasons])

  return (
    <SectionCard
      title={t('answerFeedback.reasonsHeading')}
      description={t('answerFeedback.filterHint')}
      testId="feedback-reasons-card"
    >
      <div className={className}>
        {data.totals.down > 0 ? (
          <FeedbackBarList testId="feedback-reason-bars">
            {bars.map(({ key, count, pct }) => (
              <FeedbackBarRow
                key={key}
                label={t(`answerFeedback.reasons.${key}`)}
                pct={pct}
                value={count}
                valueLabel={String(count)}
                selected={filters.reasons.includes(key)}
                onSelect={() => onReason(key)}
              />
            ))}
          </FeedbackBarList>
        ) : (
          <p className="text-muted-foreground text-sm">{t('answerFeedback.noMissed')}</p>
        )}
      </div>
    </SectionCard>
  )
}

export function TopicsCard({
  data,
  filters,
  onTopic,
  locale,
  className,
}: HealthContentProps & { className?: string }): JSX.Element {
  const t = useTranslations(platformCopy)
  const rows = useMemo(() => {
    const byKey = new Map(data.topics.map((entry) => [entry.topic, entry]))
    return CONVERSATION_TAG_KEYS.flatMap((key) => {
      const entry = byKey.get(key)
      if (!entry) return []
      const votes = entry.up + entry.down
      if (votes === 0) return []
      return [{ key, votes, rate: (entry.up / votes) * 100 }]
    }).sort((a, b) => {
      const aReadable = a.votes >= MIN_RATE_VOTES
      const bReadable = b.votes >= MIN_RATE_VOTES
      if (aReadable !== bReadable) return aReadable ? -1 : 1
      return aReadable ? b.rate - a.rate : b.votes - a.votes
    })
  }, [data.topics])
  const anyUnreadable = rows.some((row) => row.votes < MIN_RATE_VOTES)

  return (
    <SectionCard
      title={t('answerFeedback.topicsHeading')}
      description={t('answerFeedback.filterHint')}
      testId="feedback-topics-card"
    >
      <div className={cn('flex flex-col gap-3', className)}>
        {rows.length > 0 ? (
          <FeedbackBarList testId="feedback-topics">
            {rows.map(({ key, votes, rate }) => {
              const readable = votes >= MIN_RATE_VOTES
              const value = readable
                ? t('answerFeedback.percent', { value: formatCount(rate, locale) })
                : t('answerFeedback.tooFewShort')
              const volume = t('answerFeedback.orgVotes', { votes: formatCount(votes, locale) })
              return (
                <FeedbackBarRow
                  key={key}
                  testId="feedback-topic"
                  label={t(`answerFeedback.topics.${key}`)}
                  pct={readable ? rate : null}
                  meta={volume}
                  value={
                    readable ? (
                      value
                    ) : (
                      <span className="text-muted-foreground font-normal">{value}</span>
                    )
                  }
                  valueLabel={`${value}, ${volume}`}
                  title={
                    readable ? undefined : t('answerFeedback.tooFewVotes', { min: MIN_RATE_VOTES })
                  }
                  selected={filters.topics.includes(key)}
                  onSelect={() => onTopic(key)}
                />
              )
            })}
          </FeedbackBarList>
        ) : (
          <p className="text-muted-foreground text-sm">{t('answerFeedback.topicsCaveat')}</p>
        )}
        {rows.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {t('answerFeedback.topicsCaveat')}
            {anyUnreadable ? ` ${t('answerFeedback.tooFewLegend', { min: MIN_RATE_VOTES })}` : ''}
          </p>
        ) : null}
      </div>
    </SectionCard>
  )
}

export function OrganizationsCard({
  data,
  organizationIds,
  onOrg,
  locale,
  className,
}: HealthContentProps & { className?: string }): JSX.Element | null {
  const t = useTranslations(platformCopy)
  if (data.organizations.length === 0) return null
  const anyUnreadable = data.organizations.some((o) => o.up + o.down < MIN_RATE_VOTES)

  return (
    <SectionCard
      title={t('answerFeedback.orgsHeading')}
      description={t('answerFeedback.filterHint')}
      testId="feedback-orgs-card"
    >
      <div className={cn('flex flex-col gap-3', className)}>
        <Table data-testid="feedback-orgs">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('answerFeedback.orgTable.name')}</TableHead>
              <TableHead className="hidden whitespace-nowrap text-right sm:table-cell">
                {t('answerFeedback.orgTable.votes')}
              </TableHead>
              <TableHead className="whitespace-nowrap text-right">
                {t('answerFeedback.orgTable.rate')}
              </TableHead>
              <TableHead className="hidden whitespace-nowrap text-right sm:table-cell">
                {t('answerFeedback.orgTable.down')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.organizations.map((o) => {
              const votes = o.up + o.down
              const selected = organizationIds.includes(o.organizationId)
              const named = Boolean(o.organizationName?.trim())
              return (
                <TableRow
                  key={o.organizationId}
                  data-testid="feedback-org"
                  data-state={selected ? 'selected' : undefined}
                  className="cursor-pointer"
                  onClick={() => onOrg(o.organizationId)}
                >
                  <TableCell className="w-full max-w-0">
                    {/* The row is the target for the pointer; this button is the
                        same action for the keyboard and the accessibility tree. */}
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={(event) => {
                        event.stopPropagation()
                        onOrg(o.organizationId)
                      }}
                      className={cn(
                        'focus-visible:ring-ring/60 block max-w-full truncate rounded-sm text-left outline-none focus-visible:ring-2',
                        named ? 'font-medium' : 'font-mono text-xs'
                      )}
                      title={named ? o.organizationId : undefined}
                    >
                      {orgLabel(o)}
                    </button>
                    {/* On a phone the volume rides under the name instead of
                        taking a column the name needs. */}
                    <span className="text-muted-foreground block text-xs tabular-nums sm:hidden">
                      {t('answerFeedback.orgVotes', { votes: formatCount(votes, locale) })}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-right tabular-nums sm:table-cell">
                    {formatCount(votes, locale)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {votes >= MIN_RATE_VOTES ? (
                      t('answerFeedback.percent', {
                        value: formatCount((o.up / votes) * 100, locale),
                      })
                    ) : (
                      <span
                        className="text-muted-foreground font-normal"
                        title={t('answerFeedback.tooFewVotes', { min: MIN_RATE_VOTES })}
                      >
                        {t('answerFeedback.tooFewShort')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {formatCount(o.down, locale)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {anyUnreadable ? (
          <p className="text-muted-foreground text-xs">
            {t('answerFeedback.tooFewLegend', { min: MIN_RATE_VOTES })}
          </p>
        ) : null}
      </div>
    </SectionCard>
  )
}
