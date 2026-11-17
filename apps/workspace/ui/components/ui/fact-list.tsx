import type { HTMLAttributes, JSX, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function FactList({ className, ...props }: HTMLAttributes<HTMLDListElement>): JSX.Element {
  return <dl data-slot="fact-list" className={cn('flex flex-col gap-1 text-xs/5', className)} {...props} />
}

export function FactRow({
  label,
  children,
  meta,
  className,
  ...props
}: {
  label: ReactNode
  children: ReactNode
  meta?: ReactNode
  className?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>): JSX.Element {
  return (
    <div data-slot="fact-row" className={cn('flex items-baseline justify-between gap-3', className)} {...props}>
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-foreground flex min-w-0 items-baseline gap-1.5 text-right font-medium">
        <span className="min-w-0 break-words">{children}</span>
        {meta && <span className="text-muted-foreground shrink-0 font-normal tabular-nums">{meta}</span>}
      </dd>
    </div>
  )
}

export function FactBlockTitle({ className, ...props }: HTMLAttributes<HTMLParagraphElement>): JSX.Element {
  return <p className={cn('text-muted-foreground text-[11px] font-medium', className)} {...props} />
}
