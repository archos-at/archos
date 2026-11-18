'use client'

import type { JSX } from 'react'
import { ChevronRight, Filter, MessageSquareText, ThumbsDown, ThumbsUp, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { CountPill } from '@/components/ui/count-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { Item, ItemContent, ItemList, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { TimeAgo } from '@/components/ui/time-ago'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { ratingsFiltered } from '@/lib/feedback/filters'
import { cn } from '@/lib/utils'
import { excerpt, formatCount, orgLabel, type FeedbackHealthTurn } from '../answer-feedback-types'
import { FeedbackVerdictBadge } from '../feedback-turn-sheet'
import { BUSY_CLASS } from './busy-class'
import type { HealthContentProps } from './health-content-props'

const TURN_LIMIT = 50

export function TurnsCard({ data, busy, filters, locale, onClearFilters, onOpenTurn }: HealthContentProps): JSX.Element {
  const t = useTranslations(platformCopy)
  const filtered = ratingsFiltered({ ...filters, verdict: null })
  const capped = data.turns.length >= TURN_LIMIT
  const heading =
    filters.verdict === 'down'
      ? 'answerFeedback.missedHeading'
      : filters.verdict === 'up'
        ? 'answerFeedback.landedHeading'
        : 'answerFeedback.turnsHeading'

  return (
    <Card data-testid="feedback-turns-card">
      <CardHeader className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{t(heading)}</h3>
        <CountPill>{formatCount(data.turns.length, locale)}</CountPill>
        {capped ? (
          <span className="text-muted-foreground text-xs">
            {t('answerFeedback.turnsCapped', { count: TURN_LIMIT })}
          </span>
        ) : null}
        {busy ? <Spinner size="xs" className="text-muted-foreground" aria-hidden /> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className={cn(BUSY_CLASS, busy && 'opacity-60')}>
          {data.turns.length === 0 ? (
            filtered ? (
              <EmptyState
                icon={Filter}
                size="sm"
                title={t('answerFeedback.noMatch')}
                action={
                  <Button variant="secondary" size="sm" onClick={onClearFilters}>
                    <X className="size-3.5" aria-hidden />
                    {t('answerFeedback.filters.clearAll')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={filters.verdict === 'down' ? ThumbsDown : ThumbsUp}
                size="sm"
                title={t(
                  filters.verdict === 'down'
                    ? 'answerFeedback.noMissed'
                    : filters.verdict === 'up'
                      ? 'answerFeedback.noLanded'
                      : 'answerFeedback.emptyTitle'
                )}
              />
            )
          ) : (
            <ItemList as="ul" data-testid="feedback-turns">
              {data.turns.map((turn) => (
                <TurnRow
                  key={turn.id}
                  turn={turn}
                  locale={locale}
                  onOpen={() => onOpenTurn(turn)}
                />
              ))}
            </ItemList>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function TurnRow({
  turn,
  locale,
  onOpen,
}: {
  turn: FeedbackHealthTurn
  locale: string
  onOpen: () => void
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const question = excerpt(turn.question, 220)
  const hasNote = Boolean(turn.comment?.trim() || turn.expectedAnswer?.trim())
  return (
    <li data-testid="feedback-turn">
      <Item asChild className="w-full items-start">
        <button type="button" onClick={onOpen}>
          <ItemContent className="flex flex-col gap-2">
            {question ? (
              <ItemTitle className="line-clamp-2 whitespace-normal leading-snug">
                {question}
              </ItemTitle>
            ) : (
              <ItemTitle className="text-muted-foreground whitespace-normal font-normal italic">
                {t('answerFeedback.turnUnavailable')}
              </ItemTitle>
            )}
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
              <FeedbackVerdictBadge turn={turn} />
              <span
                className={cn('max-w-48 truncate', !turn.organizationName?.trim() && 'font-mono')}
              >
                {orgLabel(turn)}
              </span>
              {turn.topics.map((key) => (
                <Chip key={key} size="sm" variant="muted">
                  {t(`answerFeedback.topics.${key}`)}
                </Chip>
              ))}
              {hasNote ? (
                <span
                  className="inline-flex items-center gap-1"
                  title={t('answerFeedback.hasNote')}
                >
                  <MessageSquareText className="size-3.5" aria-hidden />
                  <span className="sr-only">{t('answerFeedback.hasNote')}</span>
                </span>
              ) : null}
              <TimeAgo date={turn.createdAt} locale={locale} className="tabular-nums" />
            </div>
          </ItemContent>
          <ChevronRight className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        </button>
      </Item>
    </li>
  )
}
