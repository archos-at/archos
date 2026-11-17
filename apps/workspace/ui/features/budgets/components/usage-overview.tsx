'use client'

import { type FC, type ReactNode, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SpendTrendChart } from '@/components/charts/spend-trend-chart'
import { useLocale, useTranslations } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { formatCredits, formatTokens } from '@/lib/format'
import { BudgetMeter } from './budget-meter'

export type BudgetUnit = 'credit' | 'token'

export interface SpendWindow {
  amount: number
  events: number
}

export interface ModelSpend {
  model: string
  day: SpendWindow
  month: SpendWindow
}

export interface MemberSpend {
  userId: string
  day: SpendWindow
  month: SpendWindow
}

export interface UsageResponse {
  unit: BudgetUnit
  summary: { day: SpendWindow; month: SpendWindow; perModel: ModelSpend[] }
  perMember: MemberSpend[] | null
  orgBudget: { dailyLimit: number | null; monthlyLimit: number | null; explicit: boolean }
  status: { blocked: boolean; blockedScope: string | null }
  dailyTrend?: Array<{ day: string } & SpendWindow> | null
}

const SPEND_SLOT_COUNT = 8
const OTHER_KEY = '__other__'

const SEGMENT_GAP_CLASS = 'border-r-2 border-card last:border-r-0'

interface ModelSeries {
  key: string
  label: string
  slot: number
  colorVar: string
  dayAmount: number
  dayEvents: number
  monthAmount: number
  monthEvents: number
}

const bySlot = (a: ModelSeries, b: ModelSeries): number => a.slot - b.slot
const byMonthSpend = (a: ModelSeries, b: ModelSeries): number => {
  if (a.key === OTHER_KEY) return 1
  if (b.key === OTHER_KEY) return -1
  return b.monthAmount - a.monthAmount
}

function buildModelSeries(perModel: ModelSpend[]): ModelSeries[] {
  const byModelId = [...perModel].sort((a, b) => a.model.localeCompare(b.model))
  const series: ModelSeries[] = []
  const tail = { dayAmount: 0, dayEvents: 0, monthAmount: 0, monthEvents: 0 }
  let tailCount = 0

  byModelId.forEach((entry, index) => {
    const values = {
      dayAmount: entry.day.amount,
      dayEvents: entry.day.events,
      monthAmount: entry.month.amount,
      monthEvents: entry.month.events,
    }
    if (index < SPEND_SLOT_COUNT) {
      series.push({
        key: entry.model,
        label: entry.model,
        slot: index + 1,
        colorVar: `var(--spend-series-${index + 1})`,
        ...values,
      })
      return
    }
    tail.dayAmount += values.dayAmount
    tail.dayEvents += values.dayEvents
    tail.monthAmount += values.monthAmount
    tail.monthEvents += values.monthEvents
    tailCount += 1
  })

  if (tailCount > 0) {
    series.push({
      key: OTHER_KEY,
      label: '',
      slot: SPEND_SLOT_COUNT + 1,
      colorVar: 'var(--spend-other)',
      ...tail,
    })
  }

  return series
}

const CompositionBar: FC<{
  segments: ModelSeries[]
  total: number
  otherLabel: string
  todayLabel: string
  monthLabel: string
  amountLabel: (value: number) => string
  requestsLabel: (count: number) => string
}> = ({ segments, total, otherLabel, todayLabel, monthLabel, amountLabel, requestsLabel }) => {
  if (total <= 0 || segments.length === 0) return null

  return (
    <div
      className="bg-muted flex h-3 w-full overflow-hidden rounded-[4px]"
      role="img"
      aria-label={`${monthLabel}: ${amountLabel(total)}`}
      data-testid="spend-composition"
    >
      {segments.map((segment) => (
        <Tooltip key={segment.key}>
          <TooltipTrigger asChild>
            <div
              className={`h-full min-w-[4px] cursor-default ${SEGMENT_GAP_CLASS}`}
              style={{
                width: `${(segment.monthAmount / total) * 100}%`,
                backgroundColor: segment.colorVar,
              }}
            />
          </TooltipTrigger>
          <TooltipContent>
            {/* Value leads, series name follows — the reader already has the
                series (they are pointing at it) and wants the number. */}
            <p className="font-medium tabular-nums">
              {amountLabel(segment.monthAmount)} · {requestsLabel(segment.monthEvents)}
            </p>
            <p className="text-xs">{segment.label || otherLabel}</p>
            <p className="text-xs tabular-nums">
              {todayLabel}: {amountLabel(segment.dayAmount)}
            </p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

const SpendTable: FC<{
  segments: ModelSeries[]
  otherLabel: string
  captionLabel: string
  todayLabel: string
  monthLabel: string
  amountLabel: (value: number) => string
  requestsLabel: (count: number) => string
}> = ({
  segments,
  otherLabel,
  captionLabel,
  todayLabel,
  monthLabel,
  amountLabel,
  requestsLabel,
}) => {
  return (
    <table className="mt-1.5 w-full border-collapse text-sm" data-testid="spend-table">
      <caption className="sr-only">{captionLabel}</caption>
      <thead>
        <tr className="card-eyebrow text-muted-foreground border-b leading-4">
          <th scope="col" className="py-1 text-left font-medium">
            <span className="sr-only">{captionLabel}</span>
          </th>
          <th scope="col" className="py-1 pl-2 text-right font-medium">
            {todayLabel}
          </th>
          <th scope="col" className="py-1 pl-2 text-right font-medium">
            {monthLabel}
          </th>
        </tr>
      </thead>
      <tbody>
        {segments.map((segment) => (
          <tr key={segment.key} className="border-b last:border-b-0">
            <th scope="row" className="min-w-0 py-1.5 pr-3 text-left font-normal">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: segment.colorVar }}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block break-all font-mono text-xs">
                    {segment.label || otherLabel}
                  </span>
                  <span className="text-muted-foreground block text-[11px]">
                    {requestsLabel(segment.monthEvents)}
                  </span>
                </span>
              </span>
            </th>
            <td className="py-1.5 pl-2 text-right align-top tabular-nums whitespace-nowrap">
              {segment.dayAmount > 0 ? (
                amountLabel(segment.dayAmount)
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
            <td className="py-1.5 pl-2 text-right align-top tabular-nums whitespace-nowrap">
              {amountLabel(segment.monthAmount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export const Stat: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className="flex min-w-14 flex-col items-end">
    <SectionLabel>{label}</SectionLabel>
    <span className="text-sm tabular-nums">{children}</span>
  </div>
)

export const UsageSkeleton: FC = () => (
  <div className="flex min-h-[16rem] flex-col gap-5">
    {[0, 1].map((i) => (
      <div key={i}>
        <div className="flex justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="mt-2 h-3 w-full" />
      </div>
    ))}
    <Skeleton className="h-24 w-full" />
  </div>
)

export interface SpendFormat {
  onOwnKey: boolean
  formatBare: (value: number) => string
  amountLabel: (value: number) => string
  requestsLabel: (count: number) => string
  unitWord: string
}

export function useSpendFormat(unit: BudgetUnit): SpendFormat {
  const t = useTranslations(organizationCopy)
  const { locale } = useLocale()
  return useMemo(() => {
    const onOwnKey = unit === 'token'
    const formatBare = (value: number): string =>
      onOwnKey ? formatTokens(value, locale) : formatCredits(value, locale)
    return {
      onOwnKey,
      formatBare,
      amountLabel: (value: number): string =>
        t(onOwnKey ? 'budgets.tokensValue' : 'budgets.creditsValue', { value: formatBare(value) }),
      requestsLabel: (count: number): string => t('budgets.tooltipRequests', { count }),
      unitWord: t(onOwnKey ? 'budgets.unitTokens' : 'budgets.unitCredits'),
    }
  }, [unit, locale, t])
}

export const UsageOverviewView: FC<{ usage: UsageResponse }> = ({ usage }) => {
  const t = useTranslations(organizationCopy)
  const { onOwnKey, amountLabel, requestsLabel } = useSpendFormat(usage.unit)

  const modelSeries = useMemo(() => buildModelSeries(usage.summary.perModel), [usage])
  const monthSeries = useMemo(
    () => modelSeries.filter((series) => series.monthAmount > 0),
    [modelSeries]
  )
  const monthStack = useMemo(() => [...monthSeries].sort(bySlot), [monthSeries])
  const monthRanked = useMemo(() => [...monthSeries].sort(byMonthSpend), [monthSeries])
  const monthTotal = monthSeries.reduce((sum, series) => sum + series.monthAmount, 0)

  return (
    <>
      {usage.status.blocked && (
        <Alert variant="destructive" data-testid="budget-blocked">
          <AlertTriangle aria-hidden />
          <AlertDescription>{t('budgets.overLimit')}</AlertDescription>
        </Alert>
      )}

      {/* An organization on its own key pays its provider, not Piloti: say
          so once, where the reader would otherwise look for credits. */}
      {onOwnKey && (
        <p className="text-muted-foreground text-xs" data-testid="budget-own-key-note">
          {t('budgets.ownKeyNote')}
        </p>
      )}

      {/* Job 1 — the ratio against each limit. */}
      <BudgetMeter
        title={t('budgets.today')}
        total={usage.summary.day.amount}
        limit={usage.orgBudget.dailyLimit}
        formatAmount={amountLabel}
      />
      <BudgetMeter
        title={t('budgets.thisMonth')}
        total={usage.summary.month.amount}
        limit={usage.orgBudget.monthlyLimit}
        formatAmount={amountLabel}
      />

      {/* Job 3 — change over time (budget admins get the series from the API). */}
      {usage.dailyTrend && usage.dailyTrend.length > 0 && (
        <div>
          <SectionLabel>{t('budgets.trendTitle')}</SectionLabel>
          <div className="mt-1.5">
            <SpendTrendChart
              points={usage.dailyTrend.map((point) => ({
                day: point.day,
                value: point.amount,
                events: point.events,
              }))}
              formatValue={amountLabel}
              requestsLabel={requestsLabel}
              emptyLabel={t('budgets.trendEmpty')}
              label={t('budgets.trendTitle')}
            />
          </div>
        </div>
      )}

      {/* Job 2 — part-to-whole by model, and its always-open table twin. */}
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <SectionLabel>{t('budgets.legendTitle')}</SectionLabel>
          {monthSeries.length > 0 && (
            <p className="text-muted-foreground text-xs tabular-nums">{amountLabel(monthTotal)}</p>
          )}
        </div>
        {monthSeries.length === 0 ? (
          <EmptyState variant="bare" title={t('budgets.legendEmpty')} />
        ) : (
          <>
            <div className="mt-1.5">
              <CompositionBar
                segments={monthStack}
                total={monthTotal}
                otherLabel={t('budgets.otherModels')}
                todayLabel={t('budgets.today')}
                monthLabel={t('budgets.thisMonth')}
                amountLabel={amountLabel}
                requestsLabel={requestsLabel}
              />
            </div>
            <SpendTable
              segments={monthRanked}
              otherLabel={t('budgets.otherModels')}
              captionLabel={t('budgets.legendTitle')}
              todayLabel={t('budgets.today')}
              monthLabel={t('budgets.thisMonth')}
              amountLabel={amountLabel}
              requestsLabel={requestsLabel}
            />
          </>
        )}
      </div>
    </>
  )
}
