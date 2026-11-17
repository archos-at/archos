'use client'

import type { JSX, ReactNode } from 'react'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WorkOsWidgets, UsersManagement } from '@workos-inc/widgets'
import '@radix-ui/themes/styles.css'
import Link from 'next/link'
import { Building2, SearchX } from 'lucide-react'

import { LoadError } from '@/components/ui/load-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataToolbar } from '@/components/ui/data-toolbar'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard, StatCardSkeleton } from '@/components/ui/stat-card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { SectionCard } from '@/features/platform/components/section-card'
import { usePlatformCan } from '@/features/platform/platform-access'
import { makeWidgetTokenFetcher } from '@/lib/workos/widget-token'
import { useResolvedAppearance, widgetTheme } from '@/lib/workos/use-widget-appearance'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { formatCount, formatDate, formatUsd as usd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AuditLogButton } from '@/components/audit/audit-log-button'
import { SpendTrendChart } from '@/components/charts/spend-trend-chart'
import { PlatformPricingCard } from './platform-pricing-card'
import { PlatformOrgBudgetDialog } from './platform-org-budget-dialog'
import { SortableHead, type SortDirection } from '@/components/ui/sortable-head'

interface SpendWindowDto {
  costUsd: number
  ownKeyCostUsd: number
  priceUsd: number
  credits: number
  tokens: number
  events: number
  ingestCostUsd?: number
  dictationCostUsd?: number
}

const platformCost = (spend: SpendWindowDto): number => spend.costUsd - spend.ownKeyCostUsd

interface PlatformOrganizationDto {
  id: string
  name: string
  createdAt: string
  isPlatformOrg: boolean
  projectCount: number
  day: SpendWindowDto
  month: SpendWindowDto
}

interface OverviewDto {
  organizations: PlatformOrganizationDto[]
  organizationsCapped: boolean
  dailyTrend: Array<{ day: string } & SpendWindowDto>
  totals: { organizations: number; projects: number; day: SpendWindowDto; month: SpendWindowDto }
  pricing: { marginMultiplier: number; usdPerCredit: number; explicit: boolean }
}

const PAGE_SIZE = 10

type SortKey = 'name' | 'projects' | 'day' | 'month' | 'revenue' | 'created'

const INITIAL_DIRECTION: Record<SortKey, SortDirection> = {
  name: 'asc',
  projects: 'desc',
  day: 'desc',
  month: 'desc',
  revenue: 'desc',
  created: 'desc',
}

const compareBy = (
  a: PlatformOrganizationDto,
  b: PlatformOrganizationDto,
  key: SortKey,
  locale: string
): number => {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name, locale)
    case 'projects':
      return a.projectCount - b.projectCount
    case 'day':
      return platformCost(a.day) - platformCost(b.day)
    case 'month':
      return platformCost(a.month) - platformCost(b.month)
    case 'revenue':
      return a.month.priceUsd - b.month.priceUsd
    case 'created':
      return Date.parse(a.createdAt) - Date.parse(b.createdAt)
  }
}

const joinHint = (parts: Array<string | undefined>): string | undefined =>
  parts.filter(Boolean).join(' · ') || undefined

const COLUMN_VISIBILITY = {
  day: 'hidden @lg:table-cell',
  revenue: 'hidden @lg:table-cell',
  allowance: 'hidden @lg:table-cell',
  projects: 'hidden @3xl:table-cell',
  created: 'hidden @4xl:table-cell',
} as const

export const PlatformOverview: FC = () => {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const appearance = useResolvedAppearance()
  const [overview, setOverview] = useState<OverviewDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const request = useRef(0)

  const load = useCallback(async () => {
    const id = ++request.current
    setLoading(true)
    try {
      const res = await fetch('/api/platform/overview')
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as OverviewDto
      if (id !== request.current) return
      setOverview(body)
      setError(false)
    } catch {
      if (id === request.current) setError(true)
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const retry = (): void => void load()

  if (!overview && error) {
    return (
      <LoadErrorAlert
        title={t('loadError')}
        hint={t('loadErrorHint')}
        onRetry={retry}
        retrying={loading}
      />
    )
  }

  if (!overview) {
    return <OverviewSkeleton />
  }

  const refreshing = loading

  return (
    <TooltipProvider delayDuration={100}>
      <div
        className="flex flex-col gap-6"
        data-testid="platform-overview"
        aria-busy={refreshing || undefined}
      >
        {error ? (
          <LoadErrorAlert
            title={t('overview.refreshError')}
            onRetry={retry}
            retrying={loading}
            testId="platform-overview-stale"
          />
        ) : null}

        <HeadlineFigures overview={overview} refreshing={refreshing} />

        <SectionCard
          title={t('trend.title')}
          description={t('trend.description')}
          testId="platform-trend"
        >
          <SpendTrendChart
            points={(overview.dailyTrend ?? []).map((point) => ({
              day: point.day,
              value: platformCost(point),
              events: point.events,
            }))}
            formatValue={(value) => usd(value, locale)}
            requestsLabel={(count) => t('trend.requests', { count })}
            emptyLabel={t('trend.empty')}
            label={t('trend.title')}
          />
        </SectionCard>

        <OrganizationDirectory overview={overview} />

        {/* The price list. A save changes what the revenue figures above mean
            from the next request on, so the overview reloads them, in place. */}
        <PlatformPricingCard onSaved={retry} />

        {/* Platform team — WorkOS widget scoped to the GRID Platform org */}
        <SectionCard
          title={t('team.title')}
          description={t('team.description')}
          testId="platform-team"
          action={
            <AuditLogButton
              endpoint="/api/platform/audit-portal"
              label={t('team.auditLogs')}
              errorMessage={t('team.auditError')}
            />
          }
        >
          <WorkOsWidgets theme={widgetTheme(appearance)}>
            <UsersManagement
              authToken={makeWidgetTokenFetcher(['widgets:users-table:manage'], 'platform')}
            />
          </WorkOsWidgets>
        </SectionCard>
      </div>
    </TooltipProvider>
  )
}

const LoadErrorAlert: FC<{
  title: string
  hint?: string
  onRetry: () => void
  retrying: boolean
  testId?: string
}> = ({ title, hint, onRetry, retrying, testId }) => {
  return (
    <LoadError
      title={title}
      description={hint}
      onRetry={onRetry}
      retrying={retrying}
      data-testid={testId}
    />
  )
}

const KPI_GRID = 'grid grid-cols-2 gap-3 @lg:grid-cols-6 @4xl:grid-cols-5'
const KPI_COUNT = '@lg:col-span-3 @4xl:col-span-1'
const KPI_AMOUNT = '@lg:col-span-2 @4xl:col-span-1'

const OverviewSkeleton: FC = () => (
  <div className="flex flex-col gap-6" data-testid="platform-overview-loading" aria-busy>
    <div className="@container">
      <div className={KPI_GRID}>
        <StatCardSkeleton className={KPI_COUNT} />
        <StatCardSkeleton className={KPI_COUNT} />
        <StatCardSkeleton className={KPI_AMOUNT} />
        <StatCardSkeleton className={KPI_AMOUNT} />
        <StatCardSkeleton className={cn(KPI_AMOUNT, 'col-span-2')} />
      </div>
    </div>
    <Skeleton className="h-56 w-full rounded-lg" />
    <Skeleton className="h-96 w-full rounded-lg" />
  </div>
)

const Figure: FC<{ children: ReactNode }> = ({ children }) => (
  <span className="block truncate whitespace-nowrap">{children}</span>
)

const HeadlineFigures: FC<{ overview: OverviewDto; refreshing: boolean }> = ({
  overview,
  refreshing,
}) => {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const { totals } = overview
  const monthMargin = totals.month.priceUsd - platformCost(totals.month)

  const shareHint = (spend: SpendWindowDto): string | undefined =>
    joinHint([
      (spend.ingestCostUsd ?? 0) > 0
        ? t('stats.ingestShare', { amount: usd(spend.ingestCostUsd ?? 0, locale) })
        : undefined,
      (spend.dictationCostUsd ?? 0) > 0
        ? t('stats.dictationShare', { amount: usd(spend.dictationCostUsd ?? 0, locale) })
        : undefined,
    ])

  return (
    <div className="@container">
      <div
        className={cn(KPI_GRID, refreshing && 'duration-base opacity-70 transition-opacity')}
        data-testid="platform-kpis"
      >
        <StatCard
          className={KPI_COUNT}
          label={t('stats.organizations')}
          value={<Figure>{formatCount(totals.organizations, locale)}</Figure>}
          hint={
            overview.organizationsCapped
              ? t('overview.cappedTile', { count: totals.organizations })
              : undefined
          }
        />
        <StatCard
          className={KPI_COUNT}
          label={t('stats.projects')}
          value={<Figure>{formatCount(totals.projects, locale)}</Figure>}
        />
        <StatCard
          className={KPI_AMOUNT}
          label={t('stats.costToday')}
          value={<Figure>{usd(platformCost(totals.day), locale)}</Figure>}
          hint={shareHint(totals.day)}
        />
        <StatCard
          className={KPI_AMOUNT}
          label={t('stats.costMonth')}
          value={<Figure>{usd(platformCost(totals.month), locale)}</Figure>}
          hint={joinHint([
            t('stats.requestsMonth', {
              count: totals.month.events,
              formatted: formatCount(totals.month.events, locale),
            }),
            shareHint(totals.month),
            totals.month.ownKeyCostUsd > 0
              ? t('stats.ownKeyExcluded', { amount: usd(totals.month.ownKeyCostUsd, locale) })
              : undefined,
          ])}
        />
        <StatCard
          className={cn(KPI_AMOUNT, 'col-span-2')}
          label={t('stats.revenueMonth')}
          value={<Figure>{usd(totals.month.priceUsd, locale)}</Figure>}
          hint={t('stats.marginHint', { margin: usd(monthMargin, locale) })}
        />
      </div>
    </div>
  )
}

const OrganizationDirectory: FC<{ overview: OverviewDto }> = ({ overview }) => {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const canManageOrganizations = usePlatformCan(PLATFORM_PERMISSIONS.organizationsManage)
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [budgetOrganization, setBudgetOrganization] = useState<PlatformOrganizationDto | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const { organizations } = overview
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = organizations.filter((org) => org.name.toLowerCase().includes(needle))
    return rows.sort((a, b) => {
      const ordered = compareBy(a, b, sortKey, locale) * (sortDirection === 'asc' ? 1 : -1)
      return ordered || a.name.localeCompare(b.name, locale)
    })
  }, [organizations, query, sortKey, sortDirection, locale])

  const sortOn = (key: SortKey): void => {
    setSortDirection(
      key === sortKey ? (sortDirection === 'asc' ? 'desc' : 'asc') : INITIAL_DIRECTION[key]
    )
    setSortKey(key)
    setOffset(0)
  }

  const safeOffset = offset < visible.length ? offset : 0
  const page = visible.slice(safeOffset, safeOffset + PAGE_SIZE)

  const column = (key: SortKey, label: string, className?: string): JSX.Element => (
    <SortableHead
      label={label}
      ariaLabel={t('overview.sortBy', { column: label })}
      active={sortKey === key}
      direction={sortDirection}
      onSort={() => sortOn(key)}
      className={className}
    />
  )

  return (
    <SectionCard
      title={t('orgs.title')}
      description={t('orgs.description')}
      testId="platform-organizations"
      empty={organizations.length === 0}
      emptyIcon={Building2}
      emptyTitle={t('orgs.empty')}
      emptyDescription={t('overview.emptyHint')}
    >
      {budgetOrganization ? (
        <PlatformOrgBudgetDialog
          key={budgetOrganization.id}
          organization={budgetOrganization}
          onClose={() => setBudgetOrganization(null)}
        />
      ) : null}
      <div className="flex flex-col gap-3">
        <DataToolbar
          searchValue={query}
          onSearchChange={(value) => {
            setQuery(value)
            setOffset(0)
          }}
          searchPlaceholder={t('overview.search')}
          searchLabel={t('overview.searchLabel')}
          clearLabel={t('overview.searchClear')}
        />

        {visible.length === 0 ? (
          <EmptyState
            variant="bare"
            icon={SearchX}
            title={t('overview.noMatches')}
            description={
              overview.organizationsCapped
                ? t('overview.cappedNoMatchHint', { count: overview.totals.organizations })
                : t('overview.noMatchesHint')
            }
          />
        ) : (
          <div className="@container rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {column('name', t('orgs.colOrganization'), 'w-full')}
                  {column(
                    'projects',
                    t('orgs.colProjects'),
                    cn('text-right', COLUMN_VISIBILITY.projects)
                  )}
                  {column('day', t('orgs.colToday'), cn('text-right', COLUMN_VISIBILITY.day))}
                  {column('month', t('orgs.colMonth'), 'text-right')}
                  {column(
                    'revenue',
                    t('orgs.colRevenue'),
                    cn('text-right', COLUMN_VISIBILITY.revenue)
                  )}
                  {column(
                    'created',
                    t('orgs.colCreated'),
                    cn('text-right', COLUMN_VISIBILITY.created)
                  )}
                  <TableHead className={cn('text-right', COLUMN_VISIBILITY.allowance)}>
                    {t('orgBudgets.column')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.map((org) => (
                  <OrganizationRow
                    key={org.id}
                    org={org}
                    canManage={canManageOrganizations}
                    onOpenBudget={() => setBudgetOrganization(org)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <Pagination
          offset={safeOffset}
          pageSize={PAGE_SIZE}
          total={visible.length}
          onOffsetChange={setOffset}
          rangeLabel={(from, to, total) => t('overview.range', { from, to, total })}
          previousLabel={t('overview.previous')}
          nextLabel={t('overview.next')}
        />
      </div>
    </SectionCard>
  )
}

const OrganizationRow: FC<{
  org: PlatformOrganizationDto
  canManage: boolean
  onOpenBudget: () => void
}> = ({ org, canManage, onOpenBudget }) => {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const canViewUsage = usePlatformCan(PLATFORM_PERMISSIONS.usageView)
  const ingest = org.month.ingestCostUsd ?? 0

  return (
    <TableRow>
      {/* `w-full max-w-0` gives the name whatever the numbers leave and
          truncates it there, instead of letting it push them off the card. */}
      <TableCell className="w-full max-w-0">
        <span className="flex min-w-0 items-center gap-2">
          {canViewUsage ? (
            <Link
              href={`/app/platform/organizations/${encodeURIComponent(org.id)}`}
              className="truncate text-sm font-medium underline-offset-4 hover:underline"
              aria-label={t('orgUsage.open', { name: org.name })}
            >
              {org.name}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium">{org.name}</span>
          )}
          {org.isPlatformOrg ? (
            <Badge variant="secondary" className="shrink-0">
              {t('orgs.platformBadge')}
            </Badge>
          ) : null}
          {/* Usage on the organization's own key this month: its cost column
              is what it paid its provider, and it is billed nothing here. */}
          {org.month.ownKeyCostUsd > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="shrink-0 cursor-default" tabIndex={0}>
                  {t('orgs.ownKeyBadge')}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t('orgs.ownKeyHint', { amount: usd(org.month.ownKeyCostUsd, locale) })}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        {/* Narrow: the allowance action sits under the name instead of in a
            column of its own. */}
        <Button
          variant="link"
          size="sm"
          className="touch-target text-muted-foreground @lg:hidden h-auto p-0 text-xs underline decoration-dotted"
          onClick={onOpenBudget}
          aria-label={t(canManage ? 'orgBudgets.openEdit' : 'orgBudgets.open', { name: org.name })}
        >
          {t('orgBudgets.column')}
        </Button>
      </TableCell>
      <TableCell
        className={cn(
          'text-muted-foreground text-right text-sm tabular-nums',
          COLUMN_VISIBILITY.projects
        )}
      >
        {formatCount(org.projectCount, locale)}
      </TableCell>
      <TableCell
        className={cn('whitespace-nowrap text-right text-sm tabular-nums', COLUMN_VISIBILITY.day)}
      >
        {usd(platformCost(org.day), locale)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
        {usd(platformCost(org.month), locale)}
        {/* Ingestion is part of the month's cost; shown under it rather than
            as a column of its own, where it was mostly zeros. */}
        {ingest > 0 ? (
          <span className="text-muted-foreground @lg:block hidden text-xs">
            {t('stats.ingestShare', { amount: usd(ingest, locale) })}
          </span>
        ) : null}
        <span className="text-muted-foreground @lg:hidden block text-xs">
          {t('orgs.revenueShort', { amount: usd(org.month.priceUsd, locale) })}
        </span>
      </TableCell>
      <TableCell
        className={cn(
          'whitespace-nowrap text-right text-sm tabular-nums',
          COLUMN_VISIBILITY.revenue
        )}
      >
        {usd(org.month.priceUsd, locale)}
      </TableCell>
      <TableCell
        className={cn(
          'text-muted-foreground whitespace-nowrap text-right text-sm tabular-nums',
          COLUMN_VISIBILITY.created
        )}
      >
        {formatDate(org.createdAt, locale)}
      </TableCell>
      <TableCell className={cn('text-right', COLUMN_VISIBILITY.allowance)}>
        <Button
          variant="secondary"
          size="sm"
          onClick={onOpenBudget}
          aria-label={t(canManage ? 'orgBudgets.openEdit' : 'orgBudgets.open', { name: org.name })}
        >
          {t(canManage ? 'orgBudgets.edit' : 'orgBudgets.view')}
        </Button>
      </TableCell>
    </TableRow>
  )
}
