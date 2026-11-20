'use client'

import type { FC } from 'react'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import type { DimensionCheckData } from '@/shared/cards/schemas'
import { AskAboutChip } from './AskAboutChip'
import { STATUS_ICON } from './status-badge'
import {
  fmtComparator,
  fmtDim,
  fmtTolerance,
  missingLabel,
  provenanceLabel,
  provenanceTitle,
} from '../lib/dimension-format'
import { statusColor, statusLabel } from '../lib/dimension-status'

interface DimChecksListProps {
  checks: DimensionCheckData[]
  className?: string
}

export const DimChecksList: FC<DimChecksListProps> = ({ checks, className }) => {
  const t = useTranslations(chatCopy)
  if (checks.length === 0) return null
  return (
    <ul className={cn('flex flex-col gap-1.5', className)}>
      {checks.map((check, index) => {
        const Icon = STATUS_ICON[check.status]
        const unit = check.unit ?? 'cm'
        const band = check.provenance === 'computed' ? fmtTolerance(check.tolerance, unit) : null
        return (
          <li key={`${check.label}-${index}`} className="card-body flex flex-col gap-0.5">
            {/* The label WRAPS and is never clipped: it names the dimension, and
                the row that decides a verdict is the row whose name a clip hid
                („Lichteinfall 45° — Gegenüberliegendes Gebäude“). It takes an 8rem
                basis and the free width, so figures sit beside a short label
                like a table row, a long label wraps over several lines, and
                where the box is too narrow for both the figures drop to a line
                of their own, right-aligned. Wrapped by the box, not by a
                breakpoint, because the same legend sits in the answer column,
                a side panel and a phone. */}
            <div className="flex items-start gap-2">
              <Icon
                className="mt-[3px] size-3.5 shrink-0"
                style={{ color: statusColor(check.status) }}
                aria-label={statusLabel(check.status, t)}
              />
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="min-w-0 flex-1 basis-[8rem] text-muted-foreground [overflow-wrap:anywhere]">
                  {check.label}
                </span>
                <span className="ml-auto flex flex-wrap items-baseline justify-end gap-x-2">
                  {check.value == null ? (
                    <span className="italic text-muted-foreground">{missingLabel(t)}</span>
                  ) : (
                    <span className="font-mono text-foreground">
                      {fmtDim(check.value, unit, t)}
                      {band && <span className="card-meta ml-1 text-muted-foreground">{band}</span>}
                    </span>
                  )}
                  {check.provenance && (
                    <span
                      className="card-meta shrink-0 rounded bg-muted px-1 py-px text-muted-foreground"
                      title={provenanceTitle(check.provenance, t)}
                    >
                      {provenanceLabel(check.provenance, t)}
                    </span>
                  )}
                  {check.required != null && (
                    <span className="font-mono text-muted-foreground">
                      {fmtComparator(check.comparator)} {fmtDim(check.required, unit, t)}
                    </span>
                  )}
                </span>
              </div>
            </div>
            {check.status === 'needs_input' && check.missing && (
              <p className="card-caption pl-5.5 leading-snug text-muted-foreground">{check.missing}</p>
            )}
            {/* The remedy is stated; the question about it is one click away.
                Everything the sentence needs is already in this row, so the
                chip builds it and puts it in the composer — no turn is fired
                and nothing is fetched. */}
            {check.status === 'needs_input' && (
              <AskAboutChip
                className="ml-5.5 mt-0.5 self-start"
                subject={check.label}
                missing={check.missing}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
