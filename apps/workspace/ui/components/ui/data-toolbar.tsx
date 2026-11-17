'use client'

import type { JSX } from 'react'
import { type ReactNode } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/search-field'
import { cn } from '@/lib/utils'

export interface DataToolbarProps {
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder: string
  searchLabel: string
  clearLabel: string
  filters?: ReactNode
  actions?: ReactNode
  selectedCount?: number
  selectionActions?: ReactNode
  selectionLabel?: (count: number) => string
  onClearSelection?: () => void
  clearSelectionLabel?: string
  className?: string
}

export function DataToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  clearLabel,
  filters,
  actions,
  selectedCount = 0,
  selectionActions,
  selectionLabel,
  onClearSelection,
  clearSelectionLabel,
  className,
}: DataToolbarProps): JSX.Element {
  if (selectedCount > 0 && selectionLabel) {
    return (
      <div
        className={cn(
          'bg-accent/40 flex flex-wrap items-center gap-2 rounded-surface px-4 py-3',
          className
        )}
        data-testid="data-toolbar-selection"
      >
        <p className="text-sm font-medium tabular-nums">{selectionLabel(selectedCount)}</p>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {selectionActions}
          {onClearSelection ? (
            <Button variant="ghost" size="sm" onClick={onClearSelection}>
              <X className="size-3.5" aria-hidden />
              {clearSelectionLabel}
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-testid="data-toolbar">
      <SearchField
        className="min-w-48 flex-1"
        value={searchValue}
        onChange={onSearchChange}
        placeholder={searchPlaceholder}
        label={searchLabel}
        clearLabel={clearLabel}
      />
      {/* On a phone the search takes its own row and the filters share the
          next rows, two to a row in equal slices. Left as loose siblings, each filter
          kept the width its caller gave it, two of those overran 390px, and
          every filter wrapped onto a row of its own. */}
      {filters ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full max-sm:*:min-w-36 max-sm:*:flex-1">
          {filters}
        </div>
      ) : null}
      {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}
