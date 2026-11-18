'use client'

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  FileWarning,
  Quote,
  RefreshCw,
  SearchX,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  type LucideIcon,
} from 'lucide-react'
import { LoadError } from '@/components/ui/load-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { StatCard } from '@/components/ui/stat-card'
import { CitationDefectChart } from '@/components/charts/citation-defect-chart'
import { useNumberFormats } from '@/hooks/use-number-formats'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { qualityScopeQuery, readQualityScope, type QualityScope } from '@/lib/quality/scope'
import { cn } from '@/lib/utils'
import {
  DEFECT_KINDS,
  type FindingCopy,
  type FindingDto,
  type FindingId,
  type SnapshotDto,
} from '../lib/citation-health-types'
import { useQualityScopeLabel } from './quality-scope-label'
import { FindingsCard } from './citation-health/findings-card'
import { LoadingState } from './citation-health/loading-state'
import { MissingSourcesCard } from './citation-health/missing-sources-card'
import { OrganizationsCard } from './citation-health/organizations-card'
import { RankedBars } from './citation-health/ranked-bars'
import { RecentCard } from './citation-health/recent-card'
import { SectionHeader } from './citation-health/section-header'

const FRACTION_METRICS = new Set(['share', 'platformShare'])

const FINDINGS_WITH_SUBJECT_FALLBACK = new Set<FindingId>([
  'retrieval_unavailable',
  'answers_ungrounded',
])

function cleanRateTone(rate: number): { className: string; icon: LucideIcon } {
  if (rate >= 0.95) return { className: 'text-success', icon: ShieldCheck }
  if (rate >= 0.8) return { className: 'text-warning', icon: ShieldAlert }
  return { className: 'text-error', icon: ShieldX }
}

export function CitationHealth({ scope }: { scope: QualityScope }): JSX.Element {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const { count, percent, decimal } = useNumberFormats(locale)
  const scopeLabel = useQualityScopeLabel()

  const scopeQuery = qualityScopeQuery(scope)
  const [snapshot, setSnapshot] = useState<SnapshotDto | null>(null)
  const [shownScope, setShownScope] = useState<{ query: string; scope: QualityScope } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const requestRef = useRef<AbortController | null>(null)
  const load = useCallback((query: string) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    const requested = readQualityScope(new URLSearchParams(query))
    setLoading(true)
    setError(false)
    fetch(`/api/platform/citation-health?${query}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as SnapshotDto
        if (controller.signal.aborted) return
        setSnapshot(data)
        setShownScope({ query, scope: data.scope ?? requested })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setError(true)
      })
      .finally(() => {
        if (requestRef.current === controller) setLoading(false)
      })
  }, [])

  useEffect(() => {
    load(scopeQuery)
    return () => requestRef.current?.abort()
  }, [scopeQuery, load])

  const kindLabel = useCallback((kind: string) => t(`citations.kinds.${kind}`), [t])
  const reasonLabel = useCallback(
    (reason: string) => {
      const key = `citations.reasons.${reason}`
      const translated = t(key)
      return translated.endsWith(key) ? reason : translated
    },
    [t]
  )

  const copyFor = useCallback(
    (finding: FindingDto): FindingCopy => {
      const vars: Record<string, string> = { subject: finding.subject?.label ?? '' }
      for (const [name, value] of Object.entries(finding.metrics)) {
        vars[name] = FRACTION_METRICS.has(name) ? percent(value) : decimal(value)
      }
      const actionKey =
        finding.subject === null && FINDINGS_WITH_SUBJECT_FALLBACK.has(finding.id)
          ? `citations.findings.${finding.id}.actionNoSubject`
          : `citations.findings.${finding.id}.action`
      return {
        title: t(`citations.findings.${finding.id}.title`),
        meaning: t(`citations.findings.${finding.id}.meaning`, vars),
        action: t(actionKey, vars),
      }
    },
    [t, decimal, percent]
  )

  const reasonRows = useMemo(
    () =>
      (snapshot?.reasons ?? []).map((row) => ({
        key: `${row.kind}:${row.reason}`,
        label: reasonLabel(row.reason),
        sublabel: kindLabel(row.kind),
        value: row.occurrences,
      })),
    [snapshot, reasonLabel, kindLabel]
  )

  const sourceRows = useMemo(
    () =>
      (snapshot?.sourceMix ?? []).map((row) => ({
        key: `${row.dimension}:${row.label}`,
        label: row.label,
        sublabel: t(`citations.dimensions.${row.dimension}`),
        value: row.turns,
      })),
    [snapshot, t]
  )

  const refreshing = loading && snapshot !== null

  const toolbar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button variant="secondary" size="sm" onClick={() => load(scopeQuery)} disabled={loading}>
        <RefreshCw
          className={cn('size-3.5', loading && 'animate-spin motion-reduce:animate-none')}
          aria-hidden
        />
        {t('citations.refresh')}
      </Button>
      {/* A plain link, not a fetch: the route sets Content-Disposition, so the
          browser downloads without buffering the bundle in JS. */}
      <Button asChild variant="secondary" size="sm">
        <a href={`/api/platform/citation-health/export?${scopeQuery}`} download>
          <Download className="size-3.5" aria-hidden />
          {t('citations.export')}
        </a>
      </Button>
    </div>
  )

  const retry = (): unknown => load(scopeQuery)

  if (!snapshot) {
    return (
      <div data-testid="citation-health" className="flex flex-col gap-4">
        {toolbar}
        {error ? (
          <LoadError
            title={t('citations.loadError')}
            description={t('loadErrorHint')}
            onRetry={retry}
            retrying={loading}
          />
        ) : (
          <LoadingState />
        )}
      </div>
    )
  }

  const tone = cleanRateTone(snapshot.totals.cleanRate)
  const staleWindow = shownScope !== null && shownScope.query !== scopeQuery
  const shownLabel = scopeLabel(shownScope?.scope ?? scope)

  return (
    <div data-testid="citation-health" className="flex flex-col gap-4" aria-busy={refreshing}>
      {toolbar}

      {error ? (
        <LoadError
          title={
            staleWindow
              ? t('citations.windowStale', {
                  requested: scopeLabel(scope),
                  shown: shownLabel,
                })
              : t('citations.loadError')
          }
          onRetry={retry}
          retrying={loading}
        />
      ) : null}

      {(shownScope?.scope ?? scope).projectIds.length > 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="citation-health-project-caveat">
          {t('citations.projectCaveat')}
        </p>
      ) : null}

      {snapshot.totals.turns === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={t('citations.empty.title')}
          description={t('citations.empty.description', { scope: shownLabel })}
          className={cn(
            'duration-base transition-opacity motion-reduce:transition-none',
            refreshing && 'opacity-60'
          )}
        />
      ) : (
        <div
          className={cn(
            'duration-base flex flex-col gap-4 transition-opacity motion-reduce:transition-none',
            refreshing && 'opacity-60'
          )}
        >
          <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<tone.icon className={tone.className} aria-hidden />}
              label={t('citations.stats.cleanRate')}
              value={<span className={tone.className}>{percent(snapshot.totals.cleanRate)}</span>}
              hint={t('citations.stats.cleanRateHint', {
                clean: count(snapshot.totals.cleanTurns),
                turns: count(snapshot.totals.turns),
              })}
            />
            <StatCard
              icon={<SearchX aria-hidden />}
              label={t('citations.stats.ungrounded')}
              value={count(snapshot.totals.ungroundedAnswers)}
              hint={t('citations.stats.ungroundedHint')}
            />
            <StatCard
              icon={<FileWarning aria-hidden />}
              label={t('citations.stats.removed')}
              value={count(snapshot.totals.citationsRemoved)}
              hint={t('citations.stats.removedHint')}
            />
            <StatCard
              icon={<Quote aria-hidden />}
              label={t('citations.stats.quotes')}
              value={count(snapshot.totals.unverifiedQuotes)}
              hint={t('citations.stats.quotesHint')}
            />
          </div>

          <FindingsCard findings={snapshot.findings} copyFor={copyFor} />

          <Card>
            <SectionHeader
              title={t('citations.trend.title')}
              description={t('citations.trend.description', { scope: shownLabel })}
            />
            <CardContent>
              <CitationDefectChart
                points={snapshot.dailyTrend}
                kinds={DEFECT_KINDS}
                kindLabel={kindLabel}
                turnsLabel={(value) => t('citations.trend.turns', { count: value })}
                findingsLabel={(value) => t('citations.trend.findings', { count: value })}
                flaggedLabel={(value) => t('citations.trend.flagged', { count: value })}
                emptyLabel={t('citations.trend.empty')}
                ariaLabel={t('citations.trend.title')}
              />
            </CardContent>
          </Card>

          {snapshot.missingSources.length > 0 ? (
            <MissingSourcesCard
              sources={snapshot.missingSources}
              total={snapshot.missingSourcesTotal ?? snapshot.missingSources.length}
              inventoryKnown={snapshot.inventoryKnown !== false}
              locale={locale}
            />
          ) : null}

          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
            <Card>
              <SectionHeader
                title={t('citations.reasonsTitle')}
                description={t('citations.reasonsDescription')}
              />
              <CardContent>
                {reasonRows.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t('citations.reasonsEmpty')}</p>
                ) : (
                  <RankedBars rows={reasonRows} format={count} />
                )}
              </CardContent>
            </Card>
            <Card>
              <SectionHeader
                title={t('citations.sourcesTitle')}
                description={t('citations.sourcesDescription')}
              />
              <CardContent>
                {sourceRows.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t('citations.sourcesEmpty')}</p>
                ) : (
                  <RankedBars rows={sourceRows} format={count} />
                )}
              </CardContent>
            </Card>
          </div>

          <OrganizationsCard
            organizations={snapshot.organizations}
            total={snapshot.organizationsTotal ?? snapshot.organizations.length}
            locale={locale}
          />

          <RecentCard
            recent={snapshot.recent}
            locale={locale}
            kindLabel={kindLabel}
            reasonLabel={reasonLabel}
            scopeQuery={shownScope?.query ?? scopeQuery}
          />
        </div>
      )}
    </div>
  )
}
