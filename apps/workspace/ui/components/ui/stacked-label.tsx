'use client'

import { cn } from '@/lib/utils'

export function StackedLabel({
  busy,
  idle,
  working,
  className,
}: {
  busy: boolean
  idle: string
  working: string
  className?: string
}) {
  return (
    <span className={cn('grid', className)}>
      <span className={cn('col-start-1 row-start-1', busy && 'invisible')} aria-hidden={busy}>
        {idle}
      </span>
      <span className={cn('col-start-1 row-start-1', !busy && 'invisible')} aria-hidden={!busy}>
        {working}
      </span>
    </span>
  )
}
