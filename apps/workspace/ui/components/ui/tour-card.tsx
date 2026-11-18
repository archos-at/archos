'use client'

import * as React from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SectionLabel } from '@/components/ui/section-label'
import { cn } from '@/lib/utils'
import type { JSX } from 'react'

export interface TourCardLabels {
  next: string
  back: string
  done: string
  close: string
  progress: string
}

export interface TourCardProps {
  title: string
  children: React.ReactNode
  step: number
  total: number
  labels: TourCardLabels
  onNext: () => void
  onBack: () => void
  onClose: () => void
  className?: string
}

export function TourCard({
  title,
  children,
  step,
  total,
  labels,
  onNext,
  onBack,
  onClose,
  className,
}: TourCardProps): JSX.Element {
  const titleId = React.useId()
  const bodyId = React.useId()
  const primaryRef = React.useRef<HTMLButtonElement>(null)
  const isFirst = step === 0
  const isLast = step >= total - 1

  React.useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true })
  }, [step])

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className={cn(
        'bg-popover text-popover-foreground w-[min(22rem,calc(100vw-2rem))] rounded-surface p-5 shadow-lg',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <SectionLabel as="p" className="tabular-nums">
          {labels.progress}
        </SectionLabel>
        <button
          type="button"
          onClick={onClose}
          aria-label={labels.close}
          className="text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-ring/60 touch-target -m-1.5 flex size-7 shrink-0 items-center justify-center rounded-control transition-colors duration-quick ease-out focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      <h2 id={titleId} className="mt-1.5 text-sm font-medium">
        {title}
      </h2>
      <div id={bodyId} className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
        {children}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <TourProgress step={step} total={total} />
        <div className="flex items-center gap-2">
          {!isFirst && (
            <Button type="button" variant="ghost" size="sm" onClick={onBack}>
              {labels.back}
            </Button>
          )}
          <Button ref={primaryRef} type="button" size="sm" onClick={onNext}>
            {isLast ? labels.done : labels.next}
          </Button>
        </div>
      </div>
    </div>
  )
}

function TourProgress({ step, total }: { step: number; total: number }): JSX.Element {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-1 rounded-none transition-colors duration-base ease-out motion-reduce:transition-none',
            index === step ? 'bg-foreground w-4' : 'w-1.5',
            index < step && 'bg-foreground/40',
            index > step && 'bg-foreground/15',
          )}
        />
      ))}
    </div>
  )
}
