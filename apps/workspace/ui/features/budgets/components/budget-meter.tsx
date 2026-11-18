'use client'

import type { FC } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'

export const BudgetMeter: FC<{
  title: string
  total: number
  limit: number | null
  formatAmount: (value: number) => string
  overNote?: string
}> = ({ title, total, limit, formatAmount, overNote }) => {
  const t = useTranslations(organizationCopy)
  const over = limit !== null && total >= limit
  const scale = limit !== null ? Math.max(limit, total) : total
  const fillPct = scale > 0 ? Math.min((total / scale) * 100, 100) : 0
  const limitPct = over && limit !== null && scale > 0 ? (limit / scale) * 100 : null
  const reading =
    limit !== null
      ? t('budgets.ofLimit', { spent: formatAmount(total), limit: formatAmount(limit) })
      : t('budgets.noLimit', { spent: formatAmount(total) })

  return (
    <div>
      {/* Stacked on a phone: side by side, the title and a long reading wrap
          against each other ("Dieser / Monat"). */}
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
        <p className="text-sm font-medium">{title}</p>
        {/* The direct label. Every meter states its own value, so the fill
            colour is a redundant cue and never the only carrier of state. */}
        <p className="text-muted-foreground text-xs tabular-nums sm:text-right">{reading}</p>
      </div>
      <div
        className="bg-muted relative mt-1.5 h-2.5 w-full overflow-hidden rounded-[4px]"
        role="img"
        aria-label={`${title}: ${reading}`}
        data-testid={`budget-meter-${over ? 'over' : 'within'}`}
      >
        <div
          className="h-full rounded-r-[4px]"
          style={{
            width: `${fillPct}%`,
            backgroundColor: over ? 'var(--spend-meter-over)' : 'var(--spend-meter)',
          }}
        />
        {limitPct !== null && (
          <span
            className="bg-foreground/60 absolute inset-y-0 w-px"
            style={{ left: `${limitPct}%` }}
            aria-hidden
            data-testid="budget-limit-tick"
          />
        )}
      </div>
      {over && (
        <p className="text-destructive mt-1 flex items-center gap-1 text-sm">
          <AlertTriangle className="size-3" aria-hidden />
          {overNote ?? t('budgets.overLimit')}
        </p>
      )}
    </div>
  )
}
