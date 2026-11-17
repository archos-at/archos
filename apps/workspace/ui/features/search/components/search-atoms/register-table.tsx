'use client'

import type { JSX, ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'

import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import { HorizontalScroll } from '@/components/ui/horizontal-scroll'
import { SortableHead } from '@/components/ui/sortable-head'
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { fitColumns, minimumRem, type ColumnFit } from '../../lib/register-fit'

export function RegisterTable({
  children,
  caption,
  testId,
  columns,
  scrollLabel,
  id,
  actionsRem = 0,
}: {
  children: ReactNode
  caption: string
  testId?: string
  id?: string
  columns: readonly ColumnFit[]
  scrollLabel: string
  actionsRem?: number
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [boxRem, setBoxRem] = useState(0)
  const minRem = minimumRem(columns)
  const wide = boxRem > 0 && minRem > boxRem + 0.0625
  const columnWidths = fitColumns(columns, boxRem - actionsRem)

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const update = (): void => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      setBoxRem(element.clientWidth / rem)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const table = (
    <table className="w-full table-fixed caption-bottom border-separate border-spacing-0 text-sm" style={{ minWidth: `${minRem}rem` }}>
      {/* The table's name for a screen reader; to the eye the header row says it. */}
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        {columnWidths.map((width, index) => (
          <col key={index} style={width === null ? undefined : { width: `${width}rem` }} />
        ))}
        {actionsRem > 0 ? <col style={{ width: `${actionsRem}rem` }} /> : null}
      </colgroup>
      {children}
    </table>
  )
  return (
    <div ref={box} id={id} className="min-w-0" data-testid={testId} data-wide={wide || undefined}>
      {wide ? (
        <HorizontalScroll cue aria-label={scrollLabel}>
          {table}
        </HorizontalScroll>
      ) : (
        table
      )}
    </div>
  )
}

export function RegisterHead({ children }: { children: ReactNode }): JSX.Element {
  return (
    <TableHeader className="sticky top-0 z-10 bg-background [&_th]:border-y [&_th]:border-border/70 [&_tr]:border-b-0">
      <TableRow className="hover:bg-transparent">{children}</TableRow>
    </TableHeader>
  )
}

export function RegisterHeadCell({
  label,
  numeric = false,
  sort,
}: {
  label: string
  numeric?: boolean
  sort: { ariaLabel: string; direction: 'asc' | 'desc' | null; onSort: () => void }
}): JSX.Element {
  return (
    <SortableHead
      className={cn('h-8 overflow-hidden whitespace-nowrap px-2', numeric && 'text-right')}
      label={label}
      ariaLabel={sort.ariaLabel}
      active={sort.direction !== null}
      direction={sort.direction ?? 'asc'}
      onSort={sort.onSort}
    />
  )
}

export function RegisterBody({ children }: { children: ReactNode }): JSX.Element {
  return <TableBody>{children}</TableBody>
}

export function RegisterRow({ children, active = false, testId, id }: { children: ReactNode; active?: boolean; testId?: string; id?: string }): JSX.Element {
  const ref = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <TableRow
      ref={ref}
      id={id}
      aria-selected={active || undefined}
      className="h-9 border-b-0 [&>td]:border-b [&>td]:border-border/50 aria-selected:bg-selected aria-selected:hover:bg-selected aria-selected:[&>td:first-child]:shadow-[inset_2px_0_0_0_var(--foreground)]"
      data-testid={testId}
    >
      {children}
    </TableRow>
  )
}

export function RegisterCell({
  children,
  kind = 'text',
  title,
  span,
}: {
  children?: ReactNode
  kind?: 'text' | 'strong' | 'code' | 'figure' | 'muted' | 'mark'
  title?: string
  span?: number
}): JSX.Element {
  return (
    <TableCell
      colSpan={span && span > 1 ? span : undefined}
      className={cn(
        'truncate px-2 py-1.5',
        kind === 'strong' && 'font-medium text-foreground',
        kind === 'code' && 'font-mono text-xs',
        kind === 'figure' && 'text-right tabular-nums',
        kind === 'muted' && 'tabular-nums text-muted-foreground',
        kind === 'text' && 'text-foreground/80',
        kind === 'mark' && '[&>*]:max-w-full!'
      )}
      title={title}
    >
      {children}
    </TableCell>
  )
}

export function RegisterTitle({ children, mark }: { children: ReactNode; mark?: ReactNode }): JSX.Element {
  if (!mark) return <>{children}</>
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate">{children}</span>
      <span className="flex shrink-0 items-center">{mark}</span>
    </span>
  )
}

export function RegisterLink({ href, children }: { href: string; children: ReactNode }): JSX.Element {
  return (
    <Link href={href} className={cn('rounded-sm hover:underline', FOCUS_RING_INSET)}>
      {children}
    </Link>
  )
}

export function RegisterActionsHead({ label }: { label: string }): JSX.Element {
  return (
    <th scope="col" className="h-8 px-1">
      <span className="sr-only">{label}</span>
    </th>
  )
}

export function RegisterActionsCell({ children }: { children: ReactNode }): JSX.Element {
  return <TableCell className="px-1 py-0.5 text-right">{children}</TableCell>
}

export const REGISTER_ACTIONS_WIDTH = 2.75
