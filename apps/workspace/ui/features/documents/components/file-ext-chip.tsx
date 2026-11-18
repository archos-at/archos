import type { JSX, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { extChipTint, fileExtensionLabel } from '../document-kind'

export function FileExtChip({
  filename,
  fallback,
  size = 'md',
  className,
}: {
  filename: string
  fallback?: ReactNode
  size?: 'xs' | 'sm' | 'md'
  className?: string
}): JSX.Element {
  const ext = fileExtensionLabel(filename)
  return (
    <span
      data-testid="file-ext-chip"
      className={cn(
        'flex shrink-0 items-center justify-center font-medium uppercase leading-none',
        size === 'md' && 'size-9 rounded-control text-xs',
        size === 'sm' && 'size-8 rounded-control text-[10px]',
        size === 'xs' && cn('size-7 rounded-full', ext.length > 3 ? 'text-[8.5px]' : 'text-[10px]'),
        ext.length > 4 && size !== 'xs' && 'text-[9px]',
        className,
      )}
      style={extChipTint(ext)}
      aria-hidden
    >
      {ext || fallback}
    </span>
  )
}
