'use client'

import { type FC } from 'react'
import { useColumnSelection } from '@/components/charts/use-column-selection'
import { SectionLabel } from '@/components/ui/section-label'
import { useLocale } from '@/i18n'

export interface CitationDefectPoint {
  day: string
  turns: number
  defectTurns: number
  byKind: Record<string, number>
}

interface CitationDefectChartProps {
  points: CitationDefectPoint[]
  kinds: readonly string[]
  kindLabel: (kind: string) => string
  turnsLabel: (count: number) => string
  findingsLabel: (count: number) => string
  flaggedLabel: (count: number) => string
  emptyLabel: string
  ariaLabel: string
}

const seriesVar = (index: number): string => `var(--chart-series-${(index % 8) + 1})`

export const CitationDefectChart: FC<CitationDefectChartProps> = ({
  points,
  kinds,
  kindLabel,
  turnsLabel,
  findingsLabel,
  flaggedLabel,
  emptyLabel,
  ariaLabel,
}) => {
  const { locale } = useLocale()
  const { selected, plotRef, plotProps, columnProps } = useColumnSelection(points.length)
  const stackTotal = (point: CitationDefectPoint): number =>
    kinds.reduce((sum, kind) => sum + (point.byKind[kind] ?? 0), 0)
  const maxStack = Math.max(...points.map(stackTotal), 0)

  const dateLabel = (day: string): string =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })

  if (points.length === 0 || maxStack <= 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>
  }

  const presentKinds = kinds
    .map((kind, index) => ({ kind, index }))
    .filter(({ kind }) => points.some((point) => (point.byKind[kind] ?? 0) > 0))

  const current = points[selected]
  const currentKinds = presentKinds.filter(({ kind }) => (current.byKind[kind] ?? 0) > 0)

  return (
    <div className="usage-viz">
      {/* The selected day. Turns observed, then how many of them carried a
          finding: the stack counts findings, and without both lines a
          3-segment column reads as three bad turns. */}
      <div className="min-h-[3.25rem] text-sm leading-5" aria-live="polite" data-testid="defect-readout">
        <p className="font-medium">{dateLabel(current.day)}</p>
        <p className="text-muted-foreground tabular-nums">
          {turnsLabel(current.turns)} · {flaggedLabel(current.defectTurns)}
        </p>
        {currentKinds.length > 0 && (
          <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            {currentKinds.map(({ kind, index }) => (
              <li key={kind} className="flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: seriesVar(index) }}
                  aria-hidden
                />
                <span>{kindLabel(kind)}</span>
                <span className="tabular-nums">{current.byKind[kind]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-end">
        <SectionLabel className="leading-4">{findingsLabel(maxStack)}</SectionLabel>
      </div>
      {/* Deliberately NOT role="img": that would collapse the whole plot into
          one opaque node and hide the per-day columns from assistive tech. The
          group keeps an accessible name; each column below is its own
          focusable, describable target. */}
      <div
        ref={plotRef}
        className="border-border flex h-24 touch-pan-y items-end gap-[2px] border-b"
        role="group"
        aria-label={ariaLabel}
        {...plotProps}
      >
        {points.map((point, index) => {
          const total = stackTotal(point)
          return (
            <button
              key={point.day}
              aria-label={`${dateLabel(point.day)}: ${findingsLabel(total)}`}
              className="focus-visible:ring-ring/60 data-[selected=true]:bg-muted flex h-full min-w-0 flex-1 cursor-default flex-col justify-end gap-[2px] rounded-sm outline-none focus-visible:ring-2"
              {...columnProps(index)}
            >
              {total > 0 ? (
                presentKinds
                  .filter(({ kind }) => (point.byKind[kind] ?? 0) > 0)
                  .reverse()
                  .map(({ kind, index: slot }, position) => (
                    <span
                      key={kind}
                      className={position === 0 ? 'block w-full rounded-t-[3px]' : 'block w-full'}
                      style={{
                        backgroundColor: seriesVar(slot),
                        height: `${Math.max(((point.byKind[kind] ?? 0) / maxStack) * 100, 3)}%`,
                      }}
                    />
                  ))
              ) : (
                <span className="bg-border block h-px w-full" />
              )}
            </button>
          )
        })}
      </div>
      <SectionLabel as="div" className="mt-1 flex justify-between leading-4">
        <span>{dateLabel(points[0].day)}</span>
        <span>{dateLabel(points[points.length - 1].day)}</span>
      </SectionLabel>
      {/* Legend: identity is never color-alone. */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {presentKinds.map(({ kind, index }) => (
          <li key={kind} className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: seriesVar(index) }}
              aria-hidden
            />
            {kindLabel(kind)}
          </li>
        ))}
      </ul>
    </div>
  )
}
