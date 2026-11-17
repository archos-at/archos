import type { JSX } from 'react'
import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

export type StatCardIconTone =
  | 'muted'
  | 'success'
  | 'warning'
  | 'info'
  | 'destructive'
  | 'office'
  | 'project'
export type StatCardIconSize = 'md' | 'sm'

const STAT_CARD_ICON_TONES: Record<StatCardIconTone, string> = {
  muted: 'bg-muted text-muted-foreground',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  info: 'bg-info-subtle text-info',
  destructive: 'bg-danger-subtle text-error',
  office: 'bg-source-office-tint text-source-office-text',
  project: 'bg-source-project-tint text-source-project-text',
}

export function StatCardIcon({
  icon: Icon,
  tone = 'muted',
  size = 'md',
  className,
}: {
  icon: LucideIcon
  tone?: StatCardIconTone
  size?: StatCardIconSize
  className?: string
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-control',
        size === 'md' ? 'size-9' : 'size-7',
        STAT_CARD_ICON_TONES[tone],
        className
      )}
      aria-hidden="true"
    >
      <Icon className={size === 'md' ? 'size-4' : 'size-3.5'} aria-hidden />
    </div>
  )
}

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: React.ReactNode
}

const STAT_CARD_CLASS = 'flex h-full min-h-28 flex-col rounded-surface bg-card p-5 shadow-xs'

export function StatCard({
  label,
  value,
  hint,
  icon,
  className,
  ...props
}: StatCardProps): JSX.Element {
  return (
    <div className={cn(STAT_CARD_CLASS, className)} {...props}>
      <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
        {icon ? (
          <span
            className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-control [&_svg]:size-3.5"
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className="mt-3 text-2xl font-medium tabular-nums">{value}</div>
      {hint && <div className="text-muted-foreground mt-1 text-pretty text-xs">{hint}</div>}
    </div>
  )
}

export function StatCardSkeleton({ className }: { className?: string }): JSX.Element {
  return (
    <div className={cn(STAT_CARD_CLASS, className)} aria-hidden>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-6 w-16" />
      <Skeleton className="mt-2 h-3 w-32" />
    </div>
  )
}
