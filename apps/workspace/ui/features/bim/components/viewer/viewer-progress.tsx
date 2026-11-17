'use client'

import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ViewerProgressProps {
  label: string
  percent: number | null
  detail?: string
  cancel?: { label: string; onClick: () => void }
  className?: string
}

export function ViewerProgress({
  label,
  percent,
  detail,
  cancel,
  className,
}: ViewerProgressProps): JSX.Element {
  const determinate = percent !== null && Number.isFinite(percent)
  const clamped = determinate ? Math.min(100, Math.max(0, percent)) : 0

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3',
        'animate-in fade-in-0 duration-base ease-out motion-reduce:animate-none',
        'group-data-[sheet=open]/stage:pt-20 group-data-[sheet=open]/stage:pb-[calc(min(60dvh,34rem)+6rem)]',
        className
      )}
    >
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div
        role="progressbar"
        aria-label={label}
        {...(determinate
          ? { 'aria-valuenow': Math.round(clamped), 'aria-valuemin': 0, 'aria-valuemax': 100 }
          : {})}
        className="h-1 w-48 overflow-hidden rounded-full bg-border"
      >
        <div
          className={cn(
            'h-full rounded-full bg-foreground/70',
            determinate
              ? // `scaleX`, not width: a width tween is a layout animation.
                'w-full origin-left transition-transform duration-quick ease-out motion-reduce:transition-none'
              : // A slow sweep, not a spinner: it says "still working" without
                'w-1/3 animate-progress-sweep motion-reduce:animate-none'
          )}
          {...(determinate ? { style: { transform: `scaleX(${clamped / 100})` } } : {})}
        />
      </div>
      {/*
        Always occupies the readout line. Download → parse used to unmount the
        percentage and lift the bar by a line; the number is gone, the gap stays.
      */}
      <p className="h-4 text-xs tabular-nums text-muted-foreground">
        {determinate ? `${Math.round(clamped)}%` : null}
        {determinate && detail ? ' · ' : null}
        {detail}
      </p>
      {cancel && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="pointer-events-auto"
          onClick={cancel.onClick}
        >
          {cancel.label}
        </Button>
      )}
    </div>
  )
}
