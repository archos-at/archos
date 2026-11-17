'use client'

import * as React from 'react'
import { Check } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useDelayedFlag } from '@/hooks/use-transient-flag'
import { cn } from '@/lib/utils'

export interface SaveButtonProps extends Omit<ButtonProps, 'children' | 'loading'> {
  busy: boolean
  saved: boolean
  children: string
  busyLabel: string
  savedLabel: string
}

export const SaveButton = React.forwardRef<HTMLButtonElement, SaveButtonProps>(
  ({ busy, saved, children, busyLabel, savedLabel, disabled, className, onClick, ...props }, ref) => {
    const showBusy = useDelayedFlag(busy)
    const state = showBusy ? 'busy' : saved && !busy ? 'saved' : 'idle'
    const inert = busy || saved
    const faces: Array<[typeof state, React.ReactNode, string]> = [
      ['idle', null, children],
      ['busy', <Spinner key="spinner" size="sm" aria-hidden="true" />, busyLabel],
      ['saved', <Check key="check" aria-hidden="true" />, savedLabel],
    ]
    return (
      <>
        <Button
          ref={ref}
          {...props}
          disabled={disabled && !inert}
          aria-disabled={inert || undefined}
          aria-busy={busy || undefined}
          data-state={state}
          className={cn('aria-disabled:cursor-default', className)}
          onClick={(event) => {
            if (inert) {
              event.preventDefault()
              return
            }
            onClick?.(event)
          }}
        >
          <span className="grid">
            {faces.map(([face, glyph, label]) => (
              <span
                key={face}
                aria-hidden={state !== face}
                className={cn(
                  'col-start-1 row-start-1 inline-flex items-center justify-center gap-2',
                  state !== face && 'invisible'
                )}
              >
                {glyph}
                {label}
              </span>
            ))}
          </span>
        </Button>
        <span className="sr-only" role="status">
          {state === 'saved' ? savedLabel : ''}
        </span>
      </>
    )
  }
)
SaveButton.displayName = 'SaveButton'
