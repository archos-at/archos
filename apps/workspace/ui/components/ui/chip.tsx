'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'
import { CountPill, type CountPillProps } from '@/components/ui/count-pill'
import { FOCUS_RING } from '@/components/ui/focus-ring'

const chipVariants = cva(
  'inline-flex items-center gap-1 rounded-full border font-medium w-fit max-w-full whitespace-nowrap shrink-0 ' +
    'align-middle outline-none transition-[scale,opacity,background-color,border-color] duration-quick ease-out ' +
    'motion-reduce:transition-none [&>svg]:pointer-events-none [&>svg]:shrink-0 ' +
    FOCUS_RING,
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        success: 'border-transparent bg-success-subtle text-success',
        warning: 'border-transparent bg-warning-subtle text-warning',
        info: 'border-transparent bg-info-subtle text-info',
        destructive: 'border-transparent bg-danger-subtle text-error',
      },
      size: {
        sm: 'h-5 px-2 text-[11px] pointer-coarse:text-xs [&>svg]:size-3',
        md: 'h-6 px-2.5 text-xs [&>svg]:size-3.5',
      },
      interactive: {
        true:
          'cursor-pointer touch-target active:scale-[0.98] active:duration-snap motion-reduce:active:scale-100 ' +
          'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 ' +
          'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        false: '',
      },
    },
    compoundVariants: [
      { interactive: true, variant: 'default', className: 'hover:bg-primary/15' },
      { interactive: true, variant: 'secondary', className: 'hover:bg-selected' },
      { interactive: true, variant: 'outline', className: 'hover:bg-hover' },
      { interactive: true, variant: 'muted', className: 'hover:bg-selected' },
      { interactive: true, variant: 'success', className: 'hover:border-success' },
      { interactive: true, variant: 'warning', className: 'hover:border-warning' },
      { interactive: true, variant: 'info', className: 'hover:border-info' },
      { interactive: true, variant: 'destructive', className: 'hover:border-danger' },
    ],
    defaultVariants: {
      variant: 'muted',
      size: 'md',
      interactive: false,
    },
  }
)

export interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {
  asChild?: boolean
}

const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(
  ({ className, variant, size, interactive, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'span'
    return (
      <Comp
        data-slot="chip"
        ref={ref}
        className={cn(chipVariants({ variant, size, interactive, className }))}
        {...props}
      />
    )
  }
)
Chip.displayName = 'Chip'

const ChipCount = React.forwardRef<HTMLSpanElement, CountPillProps>(({ className, ...props }, ref) => (
  <CountPill
    ref={ref}
    data-slot="chip-count"
    className={cn('bg-foreground/10 font-medium text-inherit', className)}
    {...props}
  />
))
ChipCount.displayName = 'ChipCount'

const ChipLabel = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} data-slot="chip-label" className={cn('min-w-0 truncate', className)} {...props} />
  )
)
ChipLabel.displayName = 'ChipLabel'

export { Chip, ChipCount, ChipLabel, chipVariants }
