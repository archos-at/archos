'use client'

import { useRef } from 'react'
import { cn } from '@/lib/utils'
import type { CardSide } from '../review-page-layer'
import { useCardFit } from '../review-stage'

export type CardPlacement = CardSide | 'detached' | 'docked'

const PLACEMENT_CLASSES: Record<Exclude<CardPlacement, 'docked'>, string> = {
  right: 'absolute top-[calc(var(--card-shift,0px)*-1)] left-4 origin-top-left',
  left: 'absolute top-[calc(var(--card-shift,0px)*-1)] right-4 origin-top-right',
  below: 'absolute top-3 left-0 origin-top-left',
  detached: 'relative origin-top',
}

const HAIRLINE_CLASSES: Partial<Record<CardPlacement, string>> = {
  right: 'top-[calc(0.875rem+var(--card-shift,0px))] -left-4 h-px w-4',
  left: 'top-[calc(0.875rem+var(--card-shift,0px))] -right-4 h-px w-4',
  below: '-top-3 left-3.5 h-3 w-px',
}

export function ReviewCard({
  placement,
  children,
  testId,
  labelledBy,
  label,
}: {
  placement: CardPlacement
  children: React.ReactNode
  testId: string
  labelledBy?: string
  label?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useCardFit(ref, placement === 'docked' ? null : placement)
  if (placement === 'docked') {
    return (
      <div
        data-testid={testId}
        data-placement="docked"
        data-review-card
        tabIndex={-1}
        className="text-popover-foreground w-full outline-none"
      >
        {children}
      </div>
    )
  }
  const hairline = HAIRLINE_CLASSES[placement]
  return (
    <div
      ref={ref}
      data-testid={testId}
      data-placement={placement}
      data-review-card
      role="dialog"
      tabIndex={-1}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={cn(
        'focus-visible:ring-ring/60 outline-none focus-visible:ring-2',
        'bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 duration-base ease-entrance motion-reduce:animate-none w-[20rem] rounded-overlay shadow-xl',
        'flex max-h-(--card-max-height) flex-col',
        PLACEMENT_CLASSES[placement]
      )}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {hairline && <span aria-hidden className={cn('bg-foreground/40 absolute', hairline)} />}
      {children}
    </div>
  )
}
