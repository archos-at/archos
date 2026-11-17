'use client'

import type { JSX } from 'react'
import { cn } from '@/lib/utils'
import { HIGHLIGHT_CSS, type BimHighlightStatus } from '../../lib/model-index'
import { ViewerSurface } from './viewer-surface'

export interface ViewerLegendEntry {
  status: BimHighlightStatus
  label: string
  count: number
}

export interface ViewerLegendProps {
  entries: readonly ViewerLegendEntry[]
  className?: string
}

export function ViewerLegend({ entries, className }: ViewerLegendProps): JSX.Element | null {
  if (entries.length === 0) return null

  return (
    <ul
      className={cn(
        'pointer-events-none flex max-w-[70%] flex-wrap gap-1.5',
        'animate-in fade-in-0 duration-base ease-out motion-reduce:animate-none',
        className
      )}
    >
      {entries.map((entry, position) => (
        <li
          key={`${entry.status}-${position}`}
        >
          <ViewerSurface className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ backgroundColor: HIGHLIGHT_CSS[entry.status] }}
            />
            <span>{entry.label}</span>
            <span className="text-muted-foreground tabular-nums">({entry.count})</span>
          </ViewerSurface>
        </li>
      ))}
    </ul>
  )
}
