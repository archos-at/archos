'use client'

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  ExternalLink,
  Filter,
  Gauge,
  MessageSquareText,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Users,
  X,
} from 'lucide-react'

import { LoadError } from '@/components/ui/load-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { CountPill } from '@/components/ui/count-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { Item, ItemContent, ItemList, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { StatCard, StatCardSkeleton } from '@/components/ui/stat-card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { CONVERSATION_TAG_KEYS, type ConversationTagKey } from '@/lib/conversations/tags'
import {
  feedbackQueryString,
  NO_RATINGS_FILTERS,
  ratingsFiltered,
  toggleValue,
  type RatingsFilters,
} from '@/lib/feedback/filters'
import type { FeedbackFilterOptions } from '@/lib/feedback/export-service'
import type { QualityScope } from '@/lib/quality/scope'
import type { QualityScopeOptions } from '@/lib/quality/scope-options'
import { cn } from '@/lib/utils'
import { SectionCard } from './section-card'
import { FeedbackDigest } from './feedback-digest'
import { FeedbackTrend, FeedbackTrendDirection } from './feedback-trend'
import { FeedbackBarList, FeedbackBarRow } from './feedback-bar-list'
import { FeedbackTurnSheet, FeedbackVerdictBadge } from './feedback-turn-sheet'
import { FeedbackExportDialog } from './feedback-export-dialog'
import { FeedbackFilterRow } from './feedback-filter-row'
import { withOrganizations } from './quality-scope-bar'
import { useQualityScopeLabel } from './quality-scope-label'
import {
  excerpt,
  FEEDBACK_REASONS,
  formatCount,
  MIN_RATE_VOTES,
  orgLabel,
  type FeedbackHealthResponse,
  type FeedbackHealthTurn,
  type FeedbackReason,
} from './answer-feedback-types'

export type { FeedbackHealthResponse } from './answer-feedback-types'

const TURN_LIMIT = 50

const BUSY_CLASS = 'transition-opacity duration-base ease-out motion-reduce:transition-none'

export interface AnswerFeedbackHealthProps {
  scope: QualityScope
  filters: RatingsFilters
  onFiltersChange: (next: RatingsFilters) => void
  onScopeChange: (next: QualityScope) => void
  scopeOptions?: QualityScopeOptions | null
}

export function AnswerFeedbackHealth({
  scope,
  filters,
  onFiltersChange,
  onScopeChange,
  scopeOptions = null,
}: AnswerFeedbackHealthProps): JSX.Element {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const scopeLabel = useQualityScopeLabel()
  const [data, setData] = useState<FeedbackHealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [options, setOptions] = useState<FeedbackFilterOptions | null>(null)
  const [openTurn, setOpenTurn] = useState<FeedbackHealthTurn | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const query = useMemo(() => ({ scope, ratings: filters }), [scope, filters])
  const search = feedbackQueryString(query)

  const filtered = ratingsFiltered(filters)
  const narrowed = filtered || scope.organizationIds.length > 0 || scope.projectIds.length > 0

  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/platform/answer-feedback?${search}`, {
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as FeedbackHealthResponse
      if (controller.signal.aborted) return
      setData(body)
    } catch {
      if (controller.signal.aborted) return
      setFailed(true)
    } finally {
      if (inFlight.current === controller) {
        setLoading(false)
        inFlight.current = null
      }
    }
  }, [search])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => () => inFlight.current?.abort(), [])

  const scopeSearch = feedbackQueryString({ scope, ratings: NO_RATINGS_FILTERS })
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/platform/answer-feedback/options?${scopeSearch}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as FeedbackFilterOptions
        if (!controller.signal.aborted) setOptions(body)
      })
      .catch(() => {
        if (!controller.signal.aborted) setOptions(null)
      })
    return () => controller.abort()
  }, [scopeSearch])

  const clearFilters = (): void => onFiltersChange({ ...NO_RATINGS_FILTERS })

  const toggleReason = (key: FeedbackReason): void =>
    onFiltersChange({
      ...filters,
      verdict: filters.verdict === 'up' ? null : filters.verdict,
      reasons: toggleValue(filters.reasons, key),
    })
  const toggleTopic = (key: ConversationTagKey): void =>
    onFiltersChange({ ...filters, topics: toggleValue(filters.topics, key) })
  const projectOwners = useMemo(
    () => new Map((scopeOptions?.projects ?? []).map((project) => [project.id, project.organizationId])),
    [scopeOptions]
  )
  const toggleOrganization = (id: string): void =>
    onScopeChange(withOrganizations(scope, toggleValue(scope.organizationIds, id), projectOwners))

  const openRow = (turn: FeedbackHealthTurn): void => {
    setOpenTurn(turn)
    setSheetOpen(true)
  }

  const busy = loading && data !== null

  const organizationName = (id: string): string => {
    const fromScope = scopeOptions?.organizations.find((org) => org.id === id)?.name
    if (fromScope) return fromScope
    const row = data?.organizations.find((org) => org.organizationId === id)
    return row ? orgLabel(row) : id
  }
  const projectName = (id: string): string => scopeOptions?.projects.find((project) => project.id === id)?.name ?? id

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className="text-muted-foreground text-sm">
        {t('answerFeedback.lead', { scope: scopeLabel(scope) })}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          aria-label={t('answerFeedback.refresh')}
          title={t('answerFeedback.refresh')}
        >
          <RefreshCw
            className={cn('size-3.5', loading && 'animate-spin motion-reduce:animate-none')}
            aria-hidden
          />
          <span className="hidden sm:inline">{t('answerFeedback.refresh')}</span>
        </Button>
        {data?.langfuse?.projectUrl ? (
          <Button asChild variant="ghost" size="sm">
            <a
              href={data.langfuse.projectUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="feedback-langfuse"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              {t('answerFeedback.langfuse')}
            </a>
          </Button>
        ) : null}
        {/* Exactly what the tab shows: the same query string as every read above. */}
        <FeedbackExportDialog query={query} organizationName={organizationName} projectName={projectName} />
      </div>
    </div>
  )

  const body = (): JSX.Element => {
    if (failed) {
      return (
        <LoadError
          title={t('answerFeedback.errorTitle')}
          description={t('answerFeedback.errorBody')}
          onRetry={load}
          retrying={loading}
          data-testid="answer-feedback-error"
          actions={
            filtered ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="size-3.5" aria-hidden />
                {t('answerFeedback.filters.clearAll')}
              </Button>
            ) : null
          }
        />
      )
    }
    if (!data) return <HealthSkeleton />

    const total = data.totals.up + data.totals.down
    if (total === 0) {
      return narrowed ? (
        <EmptyState
          icon={Filter}
          title={t('answerFeedback.noMatch')}
          action={
            filtered ? (
              <Button variant="secondary" size="sm" onClick={clearFilters} data-testid="clear-filters-empty">
                <X className="size-3.5" aria-hidden />
                {t('answerFeedback.filters.clearAll')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <EmptyState
          icon={ThumbsUp}
          title={t('answerFeedback.emptyTitle')}
          description={t('answerFeedback.emptyBody')}
        />
      )
    }

    return (
      <HealthContent
        data={data}
        busy={busy}
        digestSearch={search}
        narrowed={narrowed}
        filtered={filtered}
        filters={filters}
        organizationIds={scope.organizationIds}
        locale={locale}
        onReason={toggleReason}
        onOrg={toggleOrganization}
        onTopic={toggleTopic}
        onClearFilters={clearFilters}
        onOpenTurn={openRow}
      />
    )
  }

  return (
    <div className="usage-viz flex flex-col gap-6" data-testid="answer-feedback-health">
      {header}
      <Card>
        <CardContent>
          <FeedbackFilterRow filters={filters} onFiltersChange={onFiltersChange} options={options} />
        </CardContent>
      </Card>
      {body()}
      <FeedbackTurnSheet turn={openTurn} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  )
}

interface HealthContentProps {
  data: FeedbackHealthResponse
  busy: boolean
  digestSearch: string
  narrowed: boolean
  filtered: boolean
  filters: RatingsFilters
  organizationIds: readonly string[]
  locale: string
  onReason: (key: FeedbackReason) => void
  onOrg: (id: string) => void
  onTopic: (key: ConversationTagKey) => void
  onClearFilters: () => void
  onOpenTurn: (turn: FeedbackHealthTurn) => void
}

function HealthContent(props: HealthContentProps): JSX.Element {
  const { data, busy, digestSearch, locale } = props
  const t = useTranslations(platformCopy)
  const dim = cn(BUSY_CLASS, busy && 'opacity-60')

  return (
    <div className="flex flex-col gap-6" aria-busy={busy || undefined}>
      {busy ? (
        <span className="sr-only" role="status">
          {t('answerFeedback.updating')}
        </span>
      ) : null}
      <KpiRow data={data} narrowed={props.narrowed} locale={locale} className={dim} />

      <FeedbackDigest search={digestSearch} />

      <SectionCard
        title={t('answerFeedback.trendHeading')}
        description={t('answerFeedback.trendAria')}
        action={
          <FeedbackTrendDirection
            points={data.daily}
            windowDays={data.windowDays}
            endDay={data.to}
            minVotes={MIN_RATE_VOTES}
          />
        }
        testId="feedback-trend-card"
      >
        <div className={dim}>
          <FeedbackTrend
            points={data.daily}
            windowDays={data.windowDays}
            endDay={data.to}
            minVotes={MIN_RATE_VOTES}
          />
        </div>
      </SectionCard>

      <div className="grid gap-6 md:grid-cols-2">
        <ReasonsCard {...props} className={dim} />
        <TopicsCard {...props} className={dim} />
      </div>

      <OrganizationsCard {...props} className={dim} />

      <TurnsCard {...props} />
    </div>
  )
}

function KpiRow({
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

function ReasonsCard({
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

function TopicsCard({
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

function OrganizationsCard({
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

function TurnsCard({ data, busy, filters, locale, onClearFilters, onOpenTurn }: HealthContentProps): JSX.Element {
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

function HealthSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-6" aria-busy data-testid="answer-feedback-loading">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }, (_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
      <SkeletonCard lines={3} />
      <SkeletonCard block="h-40" />
      <div className="grid gap-6 md:grid-cols-2">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
      <SkeletonCard lines={3} />
    </div>
  )
}

function SkeletonCard({ lines = 0, block }: { lines?: number; block?: string }): JSX.Element {
  return (
    <Card aria-hidden>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {block ? <Skeleton className={cn('w-full', block)} /> : null}
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} className="h-5 w-full" />
        ))}
      </CardContent>
    </Card>
  )
}
