'use client'

import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { FileTileFooter, FileTileMedia, TileShell } from './file-tile'

/**
 * The one responsive grid every file surface uses — the Files browser, the
 * Archiv library, and the chat `document_grid`. A single auto-fill template so
 * the shared {@link FileCard} lines up at identical widths and column counts
 * everywhere, instead of the three divergent grids these surfaces used before.
 */
export function FileGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        // `items-stretch` keeps every cell as tall as the row so footers sit on
        // one line; hover must not scale a card (that would shove its neighbours).
        // `-mx-1.5`: a tile's 6px inset holds only its hover fill, so the grid bleeds by it and the
        // thumbnails stand on the column's edge, the title's and the brief's. 12px of gap and the two insets are the
        // 24px the eye reads between two thumbnails, on the 4px scale.
        // Rows too: a 10px row gap, the insets and the meta line's foot read as the columns' 24px.
        'grid items-stretch gap-3 gap-y-2.5 -mx-1.5 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))] md:[grid-template-columns:repeat(auto-fill,minmax(196px,1fr))]',
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * One loading cell in the tile's own shell ({@link TileShell}): the sheet's height, the name and
 * the meta line, on the page, the tile's own anatomy, so the first paint promises the shape that arrives.
 */
export function FileCardSkeleton() {
  return (
    <TileShell interactive={false} data-testid="file-card-skeleton">
      <FileTileMedia className="h-[124px]">
        <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
      </FileTileMedia>
      <div className="pt-3">
        <Skeleton className="h-3.5 w-3/4" />
      </div>
      <FileTileFooter>
        <Skeleton className="h-3 w-24" />
      </FileTileFooter>
    </TileShell>
  )
}
