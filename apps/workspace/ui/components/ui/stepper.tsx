'use client'

import type { JSX } from 'react'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface StepperStep {
  key: string
  label: string
  note?: string
}

export interface StepperProps {
  steps: readonly StepperStep[]
  current: number
  furthest: number
  onSelect: (index: number) => void
  label: string
  progressLabel: string
  className?: string
}

export function Stepper({
  steps,
  current,
  furthest,
  onSelect,
  label,
  progressLabel,
  className,
}: StepperProps): JSX.Element {
  return (
    <div className={cn('w-full', className)} data-slot="stepper">
      {/* The count, said once and read by everything. The visual rail below is
          `aria-hidden` for the same reason a chart's data table is the accessible
          copy: eight circles announced one by one is not progress, it is noise. */}
      <p className="sr-only" role="status">
        {progressLabel}
      </p>
      <ol className="flex items-start gap-1" aria-label={label}>
        {steps.map((step, index) => {
          const done = index < current
          const active = index === current
          const reachable = index <= furthest
          return (
            <li key={step.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full items-center gap-1">
                {/* Connectors on both sides rather than between items, so every
                    circle sits at the exact centre of its column and the rail
                    stays symmetrical however long the labels are. */}
                <span
                  aria-hidden
                  className={cn(
                    'h-px flex-1 rounded-none',
                    index === 0 ? 'opacity-0' : done || active ? 'bg-primary' : 'bg-border',
                  )}
                />
                <button
                  type="button"
                  onClick={() => reachable && onSelect(index)}
                  disabled={!reachable}
                  aria-current={active ? 'step' : undefined}
                  aria-label={
                    step.note
                      ? `${index + 1}. ${step.label} — ${step.note}`
                      : `${index + 1}. ${step.label}`
                  }
                  className={cn(
                    'focus-visible:ring-ring/60 flex size-7 shrink-0 items-center pointer-coarse:size-11 pointer-coarse:text-sm justify-center rounded-full border text-xs font-semibold tabular-nums',
                    'transition-colors duration-quick ease-out focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none',
                    done && 'border-primary bg-primary text-primary-foreground',
                    active && 'border-primary text-primary ring-primary/20 bg-card ring-4',
                    !done && !active && 'border-border text-muted-foreground bg-card',
                    reachable ? 'cursor-pointer' : 'cursor-default',
                  )}
                >
                  {done ? <Check className="size-3.5" aria-hidden /> : index + 1}
                </button>
                <span
                  aria-hidden
                  className={cn(
                    'h-px flex-1 rounded-none',
                    index === steps.length - 1 ? 'opacity-0' : done ? 'bg-primary' : 'bg-border',
                  )}
                />
              </div>
              <span
                aria-hidden
                className={cn(
                  'hidden max-w-full truncate text-center text-[11px] sm:block',
                  active ? 'text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
              {step.note && (
                <span
                  aria-hidden
                  className="text-muted-foreground hidden max-w-full truncate text-center text-[10.5px] sm:block"
                >
                  {step.note}
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {/* The phone's substitute for the hidden labels: the step being answered,
          named on a line wide enough to name it. */}
      <p aria-hidden className="text-foreground mt-2 text-center text-sm font-medium sm:hidden">
        {steps[current]?.label}
      </p>
    </div>
  )
}
