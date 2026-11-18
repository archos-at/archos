'use client'

import { type FC } from 'react'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'
import type { Ruler } from './cases'

export interface ValueBarProps {
  value: number
  limit: number
  bound: 'min' | 'max'
  pass: boolean
  valueText: string
  limitText: string
}

export const ValueBar: FC<ValueBarProps> = ({ value, limit, bound, pass, valueText, limitText }) => {
  const t = useTranslations(commonCopy)
  const top = Math.max(Math.abs(value), Math.abs(limit)) * 1.1 || 1
  const fill = Math.min(100, (Math.max(0, value) / top) * 100)
  const tick = Math.min(100, (Math.max(0, limit) / top) * 100)
  return (
    <span
      role="img"
      data-testid="value-bar"
      data-pass={pass ? 'true' : 'false'}
      data-bound={bound}
      aria-label={t('markdown.valueBar', {
        value: valueText,
        limit: limitText,
        verdict: t(pass ? 'markdown.limitKept' : 'markdown.limitMissed'),
      })}
      className="relative mt-1.5 block h-1.5 w-full min-w-16 max-w-40 rounded-full bg-muted"
    >
      <span
        className={cn('absolute inset-y-0 left-0 rounded-full', pass ? 'bg-success' : 'bg-danger')}
        style={{ width: `${fill}%` }}
      />
      <span className="absolute -inset-y-0.5 w-0.5 rounded-full bg-foreground/70" style={{ left: `calc(${tick}% - 1px)` }} />
      {/* On paper the bar keeps its numbers: a drawn value always exists as text (guardrail 4). */}
      <span className="card-meta absolute left-0 top-2 hidden whitespace-nowrap text-muted-foreground print:block">
        {valueText} / {limitText}
      </span>
    </span>
  )
}

export const ThresholdRuler: FC<{
  ruler: Ruler
  valueText: string
  format: (value: number) => string
  label: string
}> = ({ ruler, valueText, format, label }) => {
  const t = useTranslations(commonCopy)
  const nearest = ruler.nearest
  const note = nearest
    ? t(nearest.direction === 'below' ? 'markdown.ruler.below' : 'markdown.ruler.above', {
        delta: format(nearest.delta),
        label: nearest.label,
      })
    : null
  const holds = ruler.segments.find((segment) => segment.holds)
  return (
    <figure
      data-testid="threshold-ruler"
      className="my-1 flex flex-col gap-1 break-inside-avoid"
      aria-label={t('markdown.ruler.aria', { label, value: valueText, case: holds?.label ?? '–', note: note ?? '' })}
      role="img"
    >
      <div className="relative mx-2 mt-6 h-2">
        {ruler.segments.map((segment) => (
          <span
            key={`${segment.from}-${segment.to}`}
            data-holds={segment.holds ? 'true' : undefined}
            className={cn(
              'absolute inset-y-0 border-x border-background first:rounded-l-full last:rounded-r-full',
              segment.holds ? 'bg-success' : 'bg-muted'
            )}
            style={{ left: `${segment.from}%`, width: `${Math.max(0, segment.to - segment.from)}%` }}
          />
        ))}
        {ruler.ticks.map((tick) => (
          <span
            key={tick.value}
            aria-hidden="true"
            className="absolute -bottom-4 -translate-x-1/2 font-mono text-[10px] tabular-nums text-muted-foreground"
            style={{ left: `${tick.at}%` }}
          >
            {format(tick.value)}
          </span>
        ))}
        <span
          data-testid="ruler-pin"
          aria-hidden="true"
          className="absolute -top-6 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${Math.min(100, Math.max(0, ruler.pin))}%` }}
        >
          <span className="card-meta whitespace-nowrap rounded bg-foreground px-1 font-semibold text-background tabular-nums">{valueText}</span>
          <span className="h-4 w-0.5 bg-foreground" />
        </span>
      </div>
      <div aria-hidden="true" className="relative mx-2 mt-4 h-4">
        {ruler.segments.map((segment) => (
          <span
            key={`${segment.from}-${segment.label}`}
            className={cn(
              'card-meta absolute truncate text-center',
              segment.holds ? 'font-medium text-success' : 'text-muted-foreground'
            )}
            style={{ left: `${segment.from}%`, width: `${Math.max(0, segment.to - segment.from)}%` }}
          >
            {segment.label}
          </span>
        ))}
      </div>
      {note && <figcaption className="card-caption text-foreground">{note}</figcaption>}
    </figure>
  )
}
