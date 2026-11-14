import type { JSX, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { extChipTint, fileExtensionLabel } from '../document-kind'

/**
 * A file's extension as a tinted tile: "PDF", "DWG", "IFC".
 *
 * The first thing that says WHICH kind of file a header is about, before the
 * reader has parsed the name. One component for the modal header and the chat
 * peek, so the two never disagree on the tint a type gets (`extChipTint`).
 * A five-letter extension ("IFCZIP") steps the type down rather than spilling
 * out of the tile. `fallback` is drawn when the name carries no extension.
 *
 * `xs` is the row size: the upload tray's rows and the Files list's name
 * column, which used to hand-roll this tile twice. 28px and 10px, the type's
 * floor for a code read at a glance (at 24px and 8.5px „PDF“ read as a smudge);
 * a four-letter extension ("DOCX") steps down to 8.5px to stay inside it.
 */
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
