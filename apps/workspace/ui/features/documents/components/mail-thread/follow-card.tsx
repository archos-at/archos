'use client'

import type { HTMLAttributes, JSX, ReactNode } from 'react'
import { Repeat2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FollowCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  hint?: ReactNode
  titleRole?: 'status'
  titleTestId?: string
  actions?: ReactNode
  children?: ReactNode
}

export function FollowCard({
  title,
  hint,
  titleRole,
  titleTestId,
  actions,
  children,
  className,
  ...props
}: FollowCardProps): JSX.Element {
  return (
    <section
      className={cn(
        'bg-card rounded-surface @container flex flex-col gap-2.5 border p-3',
        className
      )}
      {...props}
    >
      <div className="flex flex-col gap-2.5 @md:flex-row @md:items-center @md:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <Repeat2 className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p
              className="text-sm font-medium [overflow-wrap:anywhere]"
              role={titleRole}
              data-testid={titleTestId}
            >
              {title}
            </p>
            {hint}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 @md:shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function FollowCardHint({
  children,
  testId,
}: {
  children: ReactNode
  testId?: string
}): JSX.Element {
  return (
    <p className="text-muted-foreground text-xs leading-snug" data-testid={testId}>
      {children}
    </p>
  )
}
