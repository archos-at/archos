import type { HTMLAttributes, JSX, LabelHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { cn } from '@/lib/utils'

export function DecisionSection({
  icon: Icon,
  title,
  children,
  className,
  ...props
}: {
  icon: LucideIcon
  title: ReactNode
  children: ReactNode
  className?: string
} & Omit<HTMLAttributes<HTMLElement>, 'title'>): JSX.Element {
  return (
    <section className={cn('space-y-3 rounded-surface border p-3', className)} {...props}>
      <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">{title}</span>
      </h3>
      {children}
    </section>
  )
}

export function DecisionRow({
  control,
  title,
  detail,
  muted = false,
  className,
  ...props
}: {
  control: ReactNode
  title: ReactNode
  detail?: ReactNode
  muted?: boolean
  className?: string
} & Omit<LabelHTMLAttributes<HTMLLabelElement>, 'title'>): JSX.Element {
  return (
    <label
      className={cn('flex min-w-0 cursor-pointer items-start gap-3 py-1.5', className)}
      data-muted={muted || undefined}
      {...props}
    >
      <span className="flex h-5 shrink-0 items-center">{control}</span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block min-w-0 text-sm text-foreground">{title}</span>
        {detail && (
          <span className={cn('block min-w-0 text-xs text-muted-foreground', muted && 'opacity-60')}>{detail}</span>
        )}
      </span>
    </label>
  )
}

export function DecisionBar({ children, className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn('sticky top-0 z-10 -mx-3 border-b bg-popover px-3 pb-1', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function DecisionGroupLabel({ children, count }: { children: ReactNode; count: number }): JSX.Element {
  return (
    <p className="flex min-w-0 items-center gap-1.5 pt-2 text-xs font-medium text-muted-foreground">
      <span className="min-w-0">{children}</span>
      <span aria-hidden>·</span>
      <span className="shrink-0 tabular-nums">{count}</span>
    </p>
  )
}

export function DecisionNote({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <p className={cn('text-xs text-muted-foreground', className)}>{children}</p>
}

export function DecisionSubgroup({
  title,
  children,
  ...props
}: { title: ReactNode; children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'title'>): JSX.Element {
  return (
    <div className="space-y-1 border-t pt-3" {...props}>
      <h4 className="text-sm font-medium text-foreground">{title}</h4>
      {children}
    </div>
  )
}

export function DecisionRowExtra({ children }: { children: ReactNode }): JSX.Element {
  return <div className="min-w-0 pb-1.5 pl-7">{children}</div>
}

export function DecisionTarget({ prefix, name, label }: { prefix: string; name: string; label?: string }): JSX.Element {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      {/* The spaces between the pieces are for the text a screen reader reads; the gap draws them. */}
      <span aria-hidden className="shrink-0">
        →
      </span>{' '}
      <span className="shrink-0">{prefix}</span>{' '}
      {label ? (
        <span className="min-w-[4rem] truncate" title={name}>
          {name}
        </span>
      ) : (
        <MiddleTruncate text={name} tail={16} className="min-w-0" />
      )}
      {label && (
        <>
          {' '}
          <span className="shrink-0">· {label}</span>
        </>
      )}
    </span>
  )
}

export function DecisionFileName({ name }: { name: string }): JSX.Element {
  return <MiddleTruncate text={name} tail={22} className="font-mono text-xs" />
}
