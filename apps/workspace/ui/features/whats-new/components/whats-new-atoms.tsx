import type { ComponentProps, JSX, ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

import { HorizontalScroll } from '@/components/ui/horizontal-scroll'
import { CountPill } from '@/components/ui/count-pill'
import { cn } from '@/lib/utils'

export function AreaFilterRow({ children, 'aria-label': label }: { children: ReactNode; 'aria-label': string }): JSX.Element {
  return (
    <HorizontalScroll aria-label={label} className="-my-1 py-1">
      <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">{children}</ul>
    </HorizontalScroll>
  )
}

export function WeekTimeline({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return <div className={cn('divide-y [&>*]:py-10 [&>*:first-child]:pt-2 [&>*:last-child]:pb-2', className)} {...props} />
}

export function WeekEntry({
  rail,
  children,
  className,
  ...props
}: ComponentProps<'section'> & { rail: ReactNode }): JSX.Element {
  return (
    <section className={cn('grid gap-x-10 gap-y-4 lg:grid-cols-[12rem_minmax(0,1fr)]', className)} {...props}>
      <div className="lg:sticky lg:top-6 lg:self-start">{rail}</div>
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
    </section>
  )
}

export function WeekHeading({ className, ...props }: ComponentProps<'h2'>): JSX.Element {
  return <h2 className={cn('text-base font-medium text-balance', className)} {...props} />
}

export function WeekTally({ className, ...props }: ComponentProps<'ul'>): JSX.Element {
  return (
    <ul
      className={cn('text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs lg:mt-3 lg:flex-col', className)}
      {...props}
    />
  )
}

export function WeekTallyItem({ count, children }: { count: number; children: ReactNode }): JSX.Element {
  return (
    <li className="flex items-baseline gap-1.5">
      <span className="text-foreground font-medium tabular-nums lg:min-w-5">{count}</span>
      {children}
    </li>
  )
}

export function WeekLede({ className, ...props }: ComponentProps<'p'>): JSX.Element {
  return <p className={cn('text-answer max-w-prose leading-relaxed text-pretty', className)} {...props} />
}

export function Fold({
  label,
  children,
  className,
  ...props
}: Omit<ComponentProps<'details'>, 'children'> & { label: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <details className={className} {...props}>
      <summary className="touch-target hover:text-foreground text-muted-foreground -ml-1 inline-flex cursor-pointer list-none items-center gap-1.5 rounded-control px-1 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 shrink-0 transition-transform duration-quick [[open]>summary>&]:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        {label}
      </summary>
      {children}
    </details>
  )
}

export function ChangeSections({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return <div className={cn('flex flex-col gap-8', className)} {...props} />
}

export function ChangeSectionHeader({ count, children }: { count: number; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b pb-2">
      <h3 className="text-sm font-medium">{children}</h3>
      <CountPill count={count} max={Number.POSITIVE_INFINITY} />
    </div>
  )
}

export function AreaGroups({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return <div className={cn('divide-y', className)} {...props} />
}

export function AreaGroup({ label, children }: { label?: ReactNode; children: ReactNode }): JSX.Element {
  if (!label) return <div className="py-4">{children}</div>
  return (
    <div className="grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
      <p className="text-muted-foreground text-xs leading-relaxed font-medium sm:pt-px">{label}</p>
      {children}
    </div>
  )
}

export function ChangeList({ className, ...props }: ComponentProps<'ul'>): JSX.Element {
  return <ul className={cn('flex flex-col gap-3', className)} {...props} />
}

export function ChangeItem({ className, ...props }: ComponentProps<'li'>): JSX.Element {
  return <li className={cn('max-w-prose text-sm leading-relaxed text-pretty', className)} {...props} />
}
