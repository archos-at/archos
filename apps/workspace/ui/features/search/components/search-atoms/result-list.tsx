'use client'

import type { JSX, ReactNode } from 'react'
import { useContext, useEffect, useRef } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'

import { Item, ItemContent, ItemMedia } from '@/components/ui/item'
import { SectionLabel } from '@/components/ui/section-label'
import { cn } from '@/lib/utils'
import { ResultRowFrameContext } from '../row-frame'

export function ResultSection({
  title,
  count,
  children,
  footer,
  testId,
  listId,
}: {
  title: string
  count: string
  children: ReactNode
  footer?: ReactNode
  testId?: string
  listId?: string
}): JSX.Element {
  return (
    <section className="flex min-w-0 flex-col" data-testid={testId}>
      <header className="flex items-baseline gap-2 pb-1.5">
        <SectionLabel as="h2">{title}</SectionLabel>
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      </header>
      <ul id={listId} role="listbox" aria-label={title} className="flex min-w-0 flex-col divide-y divide-border/70 border-y border-border/70">
        {children}
      </ul>
      {footer}
    </section>
  )
}

const RESULT_ROW_LAYOUT = 'items-start gap-x-3 px-2 py-2.5'

export const ACTIVE_ROW = 'aria-selected:bg-accent/60 aria-selected:shadow-[inset_2px_0_0_0_var(--foreground)]'

export function ResultRow({
  href,
  icon: Icon,
  title,
  meta,
  aside,
  children,
  active = false,
  testId,
  id,
  actions,
}: {
  href: string
  icon: LucideIcon
  title: ReactNode
  meta?: ReactNode
  aside?: ReactNode
  children?: ReactNode
  active?: boolean
  testId?: string
  id?: string
  actions?: ReactNode
}): JSX.Element {
  const Frame = useContext(ResultRowFrameContext)
  const compact = Frame !== null
  const ref = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  const content = (
    <>
      <ItemMedia className="size-5 pt-0.5 text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </ItemMedia>
      <ItemContent className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-start gap-2">
          <span className={cn('min-w-0 flex-1 text-sm font-medium text-foreground', compact ? 'truncate' : 'max-sm:line-clamp-2 sm:truncate')}>{title}</span>
          {aside ? <span className="flex shrink-0 items-center gap-1.5">{aside}</span> : null}
        </span>
        {meta ? (
          <span
            className={cn(
              'block min-w-0 text-xs leading-5 text-muted-foreground',
              compact && 'h-5 overflow-hidden'
            )}
          >
            {meta}
          </span>
        ) : null}
        {children ? compact ? <span className="flex min-w-0 flex-col">{children}</span> : children : null}
      </ItemContent>
    </>
  )
  if (Frame) {
    return (
      <Frame href={href} testId={testId} className={RESULT_ROW_LAYOUT}>
        {content}
      </Frame>
    )
  }
  return (
    <li role="none" className="relative list-none">
      <Item asChild className={cn(RESULT_ROW_LAYOUT, ACTIVE_ROW, actions && ROW_ACTIONS_ROOM)}>
        <Link ref={ref} id={id} href={href} role="option" aria-selected={active} data-testid={testId}>
          {content}
        </Link>
      </Item>
      {actions ? <RowActions>{actions}</RowActions> : null}
    </li>
  )
}

export const ROW_ACTIONS_ROOM = 'pr-11'

export function RowActions({ children }: { children: ReactNode }): JSX.Element {
  return <span className="absolute right-1 top-1.5 flex items-center">{children}</span>
}
