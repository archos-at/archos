import type { JSX } from 'react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function InsetStage({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      data-slot="inset-stage"
      className={cn(
        'bg-surface-sunken bg-drafting-grid border-base relative min-h-0 min-w-0 overflow-hidden rounded-surface border',
        'shadow-[inset_0_1px_2px_0_color-mix(in_oklch,var(--foreground)_6%,transparent)]',
        className,
      )}
      {...props}
    />
  )
}
