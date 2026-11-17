'use client'

import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { FileTileFooter, FileTileMedia, TileShell } from './file-tile'

export function FileGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid items-stretch gap-3 gap-y-2.5 -mx-1.5 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))] md:[grid-template-columns:repeat(auto-fill,minmax(196px,1fr))]',
        className
      )}
    >
      {children}
    </div>
  )
}

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
