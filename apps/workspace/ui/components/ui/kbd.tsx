import * as React from 'react'

import { cn } from '@/lib/utils'

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>): React.JSX.Element {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-inline px-1.5',
        'border border-border bg-surface-raised',
        'font-mono text-[11px] leading-none font-medium text-foreground whitespace-nowrap tabular-nums',
        'pointer-events-none select-none',
        '[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background',
        className,
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<'span'>): React.JSX.Element {
  return (
    <span
      data-slot="kbd-group"
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
