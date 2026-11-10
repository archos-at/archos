'use client'

import type { JSX, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The folder tile's glyph column: as tall as its two lines, so the glyph centres on them. */
export const FOLDER_WELL = 'flex h-9 shrink-0 items-center'

/** A folder tile's body: a white sheet with its edge and elevation 1, the documents' material (paper on a desk). */
export const FOLDER_SHEET = 'rounded-surface bg-sheet shadow-sm'

/** The tile's open button, or a plain box with the same layout while the name is being edited. */
export function FolderCardFrame({
  editing,
  onOpen,
  openLabel,
  children,
}: {
  editing: boolean
  onOpen: () => void
  openLabel: string
  children: ReactNode
}): JSX.Element {
  if (editing) return <div className={cn(FOLDER_SHEET, 'flex h-full w-full flex-row items-center text-left')}>{children}</div>
  return (
    <button data-attr="files-open"
      type="button"
      onClick={onOpen}
      aria-label={openLabel}
      className={cn(FOLDER_SHEET, 'flex h-full w-full flex-row items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50')}
    >
      {children}
    </button>
  )
}
