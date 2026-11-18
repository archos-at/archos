'use client'

import type { JSX } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface PaginationProps {
  offset: number
  pageSize: number
  total: number
  onOffsetChange: (offset: number) => void
  rangeLabel: (from: number, to: number, total: number) => string
  previousLabel: string
  nextLabel: string
  className?: string
}

export function Pagination({
  offset,
  pageSize,
  total,
  onOffsetChange,
  rangeLabel,
  previousLabel,
  nextLabel,
  className,
}: PaginationProps): JSX.Element | null {
  if (total <= pageSize) return null

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + pageSize, total)

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 pt-1', className)}>
      <p className="text-xs tabular-nums text-muted-foreground">{rangeLabel(from, to, total)}</p>
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          disabled={offset === 0}
          onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
        >
          <ChevronLeft className="size-4" aria-hidden />
          {previousLabel}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={to >= total}
          onClick={() => onOffsetChange(offset + pageSize)}
        >
          {nextLabel}
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
