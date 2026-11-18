'use client'

import type { JSX, ReactNode } from 'react'
import { Users } from 'lucide-react'

import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import { cn } from '@/lib/utils'

export function SavedSearchRow({
  name,
  summary,
  detail,
  onApply,
  controls,
}: {
  name: string
  summary?: string
  detail?: string
  onApply: () => void
  controls?: ReactNode
}): JSX.Element {
  return (
    <li className="flex min-w-0 list-none items-center gap-2 py-1.5">
      <button
        type="button"
        onClick={onApply}
        className={cn('min-w-0 flex-1 rounded-sm text-left', FOCUS_RING_INSET)}
        data-testid="saved-search-apply"
      >
        <span className="line-clamp-2 text-sm font-medium text-foreground [overflow-wrap:anywhere]">{name}</span>
        {summary ? (
          <span className="block truncate text-xs text-muted-foreground" title={summary} data-testid="saved-search-summary">
            {summary}
          </span>
        ) : null}
        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </button>
      {controls ? <div className="flex shrink-0 items-center gap-1">{controls}</div> : null}
    </li>
  )
}

export function ColleagueMark(): JSX.Element {
  return <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
}

export function SavedSearchList({ children }: { children: ReactNode }): JSX.Element {
  return <ul className="flex max-h-72 min-w-0 flex-col divide-y overflow-y-auto">{children}</ul>
}
