'use client'

import * as React from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { StackedLabel } from '@/components/ui/stacked-label'
import { useDelayedFlag } from '@/hooks/use-transient-flag'
import { cn } from '@/lib/utils'

export interface BusyButtonProps extends Omit<ButtonProps, 'loading' | 'children'> {
  busy?: boolean
  blocked?: boolean
  children: string
  busyLabel: string
  icon?: React.ReactNode
}

export const BusyButton = React.forwardRef<HTMLButtonElement, BusyButtonProps>(
  ({ busy = false, blocked = false, busyLabel, icon, children, className, onClick, ...props }, ref) => {
    const showBusy = useDelayedFlag(busy)
    const dimmed = useDelayedFlag(blocked && !busy)
    const waiting = busy || blocked
    return (
      <Button
        ref={ref}
        {...props}
        aria-disabled={waiting || undefined}
        aria-busy={busy || undefined}
        data-busy={showBusy || undefined}
        className={cn('aria-disabled:cursor-default', dimmed && 'opacity-60', className)}
        onClick={(event) => {
          if (waiting) {
            event.preventDefault()
            return
          }
          onClick?.(event)
        }}
      >
        {showBusy ? <Spinner size="sm" aria-hidden="true" className={icon ? undefined : 'hidden'} /> : icon}
        <StackedLabel busy={showBusy} idle={children} working={busyLabel} className={icon ? 'text-start' : undefined} />
      </Button>
    )
  }
)
BusyButton.displayName = 'BusyButton'
