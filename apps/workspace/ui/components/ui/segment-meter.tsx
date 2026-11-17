import type { JSX } from 'react'
import * as React from 'react'

import { cn } from '@/lib/utils'

export type MeterTone = 'success' | 'info' | 'warning' | 'destructive' | 'muted' | 'ink' | 'inkSoft'

export const TONE_INK: Record<MeterTone, string> = {
  success: 'text-success',
  info: 'text-info',
  warning: 'text-warning',
  destructive: 'text-error',
  muted: 'text-muted-foreground/45',
  ink: 'text-muted-foreground',
  inkSoft: 'text-[color-mix(in_oklab,var(--muted-foreground)_40%,var(--muted))]',
}

export function ToneSwatch({ tone, className }: { tone: MeterTone; className?: string }): JSX.Element {
  return (
    <span
      aria-hidden
      data-slot="tone-swatch"
      className={cn('inline-block size-2.5 shrink-0 rounded-control bg-current', TONE_INK[tone], className)}
    />
  )
}

export interface MeterSegment {
  key: string
  value: number
  tone: MeterTone
}

export interface SegmentMeterProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'role'> {
  segments: readonly MeterSegment[]
  label: string
}

const MIN_SHARE = 0.03

export function segmentEnds(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0 || values.length === 0) return []
  const raw = values.map((value) => Math.max(value / total, MIN_SHARE))
  const scale = raw.reduce((sum, share) => sum + share, 0)
  let end = 0
  return raw.map((share, index) => {
    end = index === raw.length - 1 ? 1 : end + share / scale
    return end
  })
}

export function SegmentMeter({ segments, label, className, ...props }: SegmentMeterProps): JSX.Element {
  const drawn = segments.filter((segment) => segment.value > 0)
  const ends = segmentEnds(drawn.map((segment) => segment.value))
  return (
    <div
      role="img"
      aria-label={label}
      data-slot="segment-meter"
      className={cn('bg-muted relative isolate h-2 w-full overflow-hidden rounded-none', className)}
      {...props}
    >
      {drawn.map((segment, index) => (
        <span
          key={segment.key}
          data-segment={segment.key}
          className={cn(
            'absolute inset-0 origin-left bg-current transition-transform duration-base ease-out motion-reduce:transition-none',
            TONE_INK[segment.tone]
          )}
          style={{ transform: `scaleX(${ends[index]})`, zIndex: drawn.length - index }}
        />
      ))}
      {ends.slice(0, -1).map((end, index) => (
        <span
          key={`gap-${drawn[index].key}`}
          aria-hidden
          data-segment-gap
          className="absolute inset-0 transition-transform duration-base ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(${end * 100}%)`, zIndex: drawn.length + 1 }}
        >
          <span className="bg-muted absolute inset-y-0 -left-px w-px" />
        </span>
      ))}
    </div>
  )
}
