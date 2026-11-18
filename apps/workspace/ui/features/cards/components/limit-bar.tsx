'use client'

import type { FC } from 'react'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import type { DimensionCheckData } from '@/shared/cards/schemas'
import {
  fmtComparator,
  fmtDim,
  fmtTolerance,
  missingLabel,
  provenanceLabel,
  provenanceTitle,
} from '../lib/dimension-format'
import { statusColor } from '../lib/dimension-status'

interface LimitBarProps {
  check: DimensionCheckData
  className?: string
}

export const LimitBar: FC<LimitBarProps> = ({ check, className }) => {
  const t = useTranslations(chatCopy)
  const { label, value, required, comparator, status } = check
  const unit = check.unit ?? 'cm'
  const max = Math.max(value ?? 0, required ?? 0) * 1.08 || 1
  const valuePct = value != null ? Math.min((value / max) * 100, 100) : 0
  const requiredPct = required != null ? Math.min((required / max) * 100, 100) : null

  const band = check.provenance === 'computed' ? fmtTolerance(check.tolerance, unit) : null
  const tolerance = band != null && check.tolerance != null ? check.tolerance : null
  const bandLowPct = value != null && tolerance != null ? Math.max(((value - tolerance) / max) * 100, 0) : null
  const bandHighPct = value != null && tolerance != null ? Math.min(((value + tolerance) / max) * 100, 100) : null

  const low = value != null && tolerance != null ? value - tolerance : null
  const high = value != null && tolerance != null ? value + tolerance : null
  const straddlesLimit =
    required != null && low != null && high != null
      ? comparator === '<='
        ? low <= required && high > required
        : comparator === '>='
          ? high >= required && low < required
          : false
      : false

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="card-body flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">
          {value == null ? (
            <span className="font-sans italic text-muted-foreground">{missingLabel(t)}</span>
          ) : (
            fmtDim(value, unit, t)
          )}
          {band && <span className="card-meta ml-1 text-muted-foreground">{band}</span>}
          {check.provenance && (
            <span
              className="card-meta ml-1.5 rounded bg-muted px-1 py-px font-sans text-muted-foreground"
              title={provenanceTitle(check.provenance, t)}
            >
              {provenanceLabel(check.provenance, t)}
            </span>
          )}
          {required != null && (
            <span className="text-muted-foreground">
              {' '}
              {fmtComparator(comparator)} {fmtDim(required, unit, t)}
            </span>
          )}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-muted">
        {value != null && (
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${valuePct}%`, backgroundColor: statusColor(status) }}
          />
        )}
        {bandLowPct != null && bandHighPct != null && (
          <div
            className="absolute inset-y-0 border-x border-foreground/40 bg-foreground/15"
            style={{ left: `${bandLowPct}%`, width: `${Math.max(bandHighPct - bandLowPct, 0.5)}%` }}
            aria-hidden="true"
          />
        )}
        {requiredPct != null && (
          <div
            className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
            style={{ left: `${requiredPct}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {straddlesLimit && (
        <p className="card-caption leading-snug text-muted-foreground">
          {t('cards.kit.toleranceStraddlesLimit')}
        </p>
      )}
      {status === 'needs_input' && check.missing && (
        <p className="card-caption leading-snug text-muted-foreground">{check.missing}</p>
      )}
    </div>
  )
}
