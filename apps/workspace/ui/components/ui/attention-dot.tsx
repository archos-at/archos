import type { JSX } from 'react'

import { cn } from '@/lib/utils'

export function AttentionDot({
  show,
  label,
  className,
}: {
  show: boolean
  label?: string
  className?: string
}): JSX.Element | null {
  if (!show) return null
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-slot="attention-dot"
      className={cn('bg-primary ring-background pointer-events-none block size-2.5 rounded-full ring-2', className)}
    />
  )
}
