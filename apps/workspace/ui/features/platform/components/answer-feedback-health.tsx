'use client'

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Filter, RefreshCw, ThumbsUp, X } from 'lucide-react'

import { LoadError } from '@/components/ui/load-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { ConversationTagKey } from '@/lib/conversations/tags'
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
import { HealthContent } from './answer-feedback-health/health-content'
import { HealthSkeleton } from './answer-feedback-health/health-skeleton'
import { FeedbackExportDialog } from './feedback-export-dialog'
import { FeedbackFilterRow } from './feedback-filter-row'
import { FeedbackTurnSheet } from './feedback-turn-sheet'
import { withOrganizations } from './quality-scope-bar'
import { useQualityScopeLabel } from './quality-scope-label'
import {
  orgLabel,
  type FeedbackHealthResponse,
  type FeedbackHealthTurn,
  type FeedbackReason,
} from './answer-feedback-types'

export type { FeedbackHealthResponse } from './answer-feedback-types'

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
