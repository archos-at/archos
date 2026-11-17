import type { JSX } from 'react'
import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export type EmptyStateDiscTone = 'muted' | 'destructive' | 'warning'
export type EmptyStateDiscSize = 'md' | 'sm'

const EMPTY_STATE_DISC_TONES: Record<EmptyStateDiscTone, string> = {
  muted: 'bg-sheet text-muted-foreground',
  destructive: 'border-transparent bg-danger-subtle text-error',
  warning: 'border-transparent bg-warning-subtle text-warning',
}

export function EmptyStateDisc({
  icon: Icon,
  tone = 'muted',
  size = 'md',
  className,
}: {
  icon: LucideIcon
  tone?: EmptyStateDiscTone
  size?: EmptyStateDiscSize
  className?: string
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-control shadow-sm',
        size === 'md' ? 'size-12' : 'size-9',
        EMPTY_STATE_DISC_TONES[tone],
        className
      )}
      aria-hidden="true"
    >
      <Icon className="size-5" aria-hidden />
    </div>
  )
}

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon
  art?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  variant?: 'panel' | 'bare'
  tone?: EmptyStateDiscTone
  size?: EmptyStateDiscSize
}

export function EmptyState({
  icon: Icon,
  art,
  title,
  description,
  action,
  variant = 'panel',
  tone = 'muted',
  size = 'md',
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col items-center justify-center text-center',
        variant === 'panel' ? 'rounded-surface border border-dashed bg-muted px-6 py-12' : 'py-10',
        'animate-in fade-in-0 duration-base ease-entrance motion-reduce:animate-none',
        className,
      )}
      {...props}
    >
      {art ? (
        <div className="mb-5">{art}</div>
      ) : Icon && (
        <EmptyStateDisc
          icon={Icon}
          tone={tone}
          size={size}
          className="mb-4 animate-in zoom-in-95 duration-base ease-entrance motion-reduce:animate-none"
        />
      )}
      {/* The headline is the section step, 16/24/600 (paper on a desk, type): at 14/500 it was the size of the body under it. */}
      <p className="text-balance text-section text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-pretty text-sm leading-5 text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5 shrink-0">{action}</div>}
    </div>
  )
}
