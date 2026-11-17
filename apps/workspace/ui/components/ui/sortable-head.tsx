'use client'

import type { FC } from 'react'
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export type SortDirection = 'asc' | 'desc'

export const SortableHead: FC<{
  label: string
  ariaLabel: string
  active: boolean
  direction: SortDirection
  onSort: () => void
  className?: string
}> = ({ label, ariaLabel, active, direction, onSort, className }) => {
  const Icon = active ? (direction === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
  return (
    <TableHead
      className={className}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={onSort}
        aria-label={ariaLabel}
        className={cn(
          'hover:text-foreground focus-visible:ring-ring/60 touch-target inline-flex items-center gap-1 text-balance rounded-control focus-visible:outline-none focus-visible:ring-2',
          active && 'text-foreground'
        )}
      >
        {label}
        <Icon className={cn('size-3 shrink-0', !active && 'opacity-50')} aria-hidden />
      </button>
    </TableHead>
  )
}
