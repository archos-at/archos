import { type FC } from 'react'
import { useColumnSelection } from '@/components/charts/use-column-selection'
import { SectionLabel } from '@/components/ui/section-label'
import { useLocale } from '@/i18n'

export interface SpendTrendPoint {
  day: string
  value: number
  events: number
}

interface SpendTrendChartProps {
  points: SpendTrendPoint[]
  formatValue: (value: number) => string
  requestsLabel?: (count: number) => string
  emptyLabel: string
  label?: string
}

export const SpendTrendChart: FC<SpendTrendChartProps> = ({
  points,
  formatValue,
  requestsLabel,
  emptyLabel,
  label,
}) => {
  const { locale } = useLocale()
  const { selected, plotRef, plotProps, columnProps } = useColumnSelection(points.length)
  const maxValue = Math.max(...points.map((point) => point.value), 0)
  const dateLabel = (day: string): string =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const readout = (point: SpendTrendPoint): string =>
    `${dateLabel(point.day)}: ${formatValue(point.value)}${requestsLabel ? ` · ${requestsLabel(point.events)}` : ''}`

  if (points.length === 0 || maxValue <= 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <div className="usage-viz">
      {/* The selected day. `aria-live` so a keyboard walk announces each one;
          the min-height keeps the plot from jumping when the text wraps. */}
      <p
        className="min-h-5 text-sm leading-5 tabular-nums"
        aria-live="polite"
        data-testid="spend-trend-readout"
      >
        {readout(points[selected])}
      </p>
      <div className="flex justify-end">
        <SectionLabel className="leading-4">{formatValue(maxValue)}</SectionLabel>
      </div>
      <div
        ref={plotRef}
        role="group"
        aria-label={label}
        className="flex h-24 touch-pan-y items-end gap-[2px] border-b border-border"
        {...plotProps}
      >
        {points.map((point, index) => (
          <button
            key={point.day}
            aria-label={readout(point)}
            className="flex h-full min-w-0 flex-1 cursor-default items-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 data-[selected=true]:bg-muted"
            {...columnProps(index)}
          >
            {point.value > 0 ? (
              <span
                className="block w-full rounded-t-[3px]"
                style={{
                  backgroundColor: 'var(--chart-series-1)',
                  height: `${Math.max((point.value / maxValue) * 100, 3)}%`,
                }}
              />
            ) : (
              <span className="block h-px w-full bg-border" />
            )}
          </button>
        ))}
      </div>
      <SectionLabel as="div" className="mt-1 flex justify-between leading-4">
        <span>{dateLabel(points[0].day)}</span>
        <span>{dateLabel(points[points.length - 1].day)}</span>
      </SectionLabel>
    </div>
  )
}
