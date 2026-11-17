'use client'

import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react'
import { forwardRef } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { cn } from '@/lib/utils'

export function SimilarRail({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <section
      aria-label={label}
      data-testid="similar-passages"
      className={cn('flex max-h-[40dvh] min-h-0 max-w-full shrink-0 flex-col gap-3 md:max-h-none md:w-80', className)}
    >
      {children}
    </section>
  )
}

export function SimilarList({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain pb-1 pr-1">{children}</div>
  )
}

export function SimilarGroupHeading({
  tile,
  name,
  meta,
}: {
  tile: ReactNode
  name: string
  meta?: ReactNode
}): JSX.Element {
  return (
    <h3 className="flex min-w-0 items-center gap-2.5">
      {tile}
      <span className="min-w-0 truncate text-sm font-medium text-foreground" title={name}>
        {name}
      </span>
      {meta}
    </h3>
  )
}

export function SimilarGroupNote({ children }: { children: ReactNode }): JSX.Element {
  return <span className="shrink-0 text-xs text-muted-foreground">{children}</span>
}

export const SimilarPassageButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    current?: boolean
    quote: string
    source: ReactNode
    page?: string | null
    openLabel: string
  }
>(function SimilarPassageButton({ current, quote, source, page, openLabel, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-current={current ? 'true' : undefined}
      data-similar-passage=""
      className={cn(
        'group/passage flex w-full flex-col gap-1.5 rounded-md border px-3 py-1.5 text-left outline-none',
        'transition-colors duration-quick ease-out motion-reduce:transition-none',
        FOCUS_RING,
        current
          ? 'border-border bg-accent/70'
          : 'border-transparent hover:bg-hover',
        className
      )}
      {...props}
    >
      <span className="line-clamp-4 text-[13px] leading-relaxed text-foreground">„{quote}“</span>
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{source}</span>
        {page && <span className="shrink-0 tabular-nums">{page}</span>}
        {!current && (
          <span
            aria-hidden
            className="hidden shrink-0 items-center gap-0.5 font-medium text-foreground/70 group-hover/passage:inline-flex group-focus-visible/passage:inline-flex pointer-coarse:inline-flex"
          >
            {openLabel}
            <ArrowUpRight className="size-3" />
          </span>
        )}
      </span>
    </button>
  )
})
