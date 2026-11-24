'use client'

import type { JSX, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const FOLDER_WELL = 'flex h-9 shrink-0 items-center'

export const FOLDER_SHEET = 'rounded-surface bg-sheet shadow-sm'

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
      className={cn(FOLDER_SHEET, 'flex h-full w-full flex-row items-center text-left transition-colors duration-quick ease-out group-hover:bg-sheet-hover motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50')}
    >
      {children}
    </button>
  )
}
