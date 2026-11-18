'use client'

import type { JSX, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import Link from 'next/link'

import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import { cn } from '@/lib/utils'
import { MetaLine } from './result-meta'
import { ACTIVE_ROW, ROW_ACTIONS_ROOM, RowActions } from './result-list'

export function RegisterStack({ children, label, testId, id }: { children: ReactNode; label: string; testId?: string; id?: string }): JSX.Element {
  return (
    <ul id={id} role="listbox" className="flex min-w-0 flex-col divide-y divide-border/70 border-y border-border/70" aria-label={label} data-testid={testId}>
      {children}
    </ul>
  )
}

export function RegisterStackRow({
  href,
  code,
  title,
  meta,
  where,
  aside,
  active = false,
  testId,
  id,
  actions,
}: {
  href: string
  code?: ReactNode
  title: ReactNode
  meta?: ReadonlyArray<ReactNode | null | undefined | false>
  where?: ReactNode
  aside?: ReactNode
  active?: boolean
  testId?: string
  id?: string
  actions?: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <li role="none" className="relative list-none">
      <Link
        ref={ref}
        id={id}
        href={href}
        role="option"
        aria-selected={active}
        data-testid={testId}
        className={cn(
          'flex min-w-0 flex-col gap-0.5 px-1 py-2.5 transition-colors duration-snap ease-out hover:bg-hover motion-reduce:transition-none',
          FOCUS_RING_INSET,
          ACTIVE_ROW,
          actions && ROW_ACTIONS_ROOM
        )}
      >
        {code ? <span className="min-w-0 truncate font-mono text-xs text-foreground/80">{code}</span> : null}
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
          {aside ? <span className="flex shrink-0 items-center gap-1.5">{aside}</span> : null}
        </span>
        {meta && meta.some(Boolean) ? (
          <span className="min-w-0 text-xs text-muted-foreground">
            <MetaLine parts={meta} />
          </span>
        ) : null}
        {where ? <span className="flex min-w-0 pt-0.5 text-xs">{where}</span> : null}
      </Link>
      {actions ? <RowActions>{actions}</RowActions> : null}
    </li>
  )
}
