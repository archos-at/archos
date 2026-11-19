import type { JSX, ReactNode } from 'react'
import { Item, ItemList } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'

export const DETAIL_PANEL = '-mx-4 rounded-none border-0 divide-y-0 bg-transparent'

export function DetailSkeleton({ back }: { back?: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-6 p-4 pt-1 sm:px-8 sm:pb-6 sm:pt-3" aria-busy="true" data-testid="inbound-mail-detail-loading">
      {back}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3.5 w-1/3" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-9/12" />
      </div>
      {/* The attachments' own list, so the rows land where their skeletons stood. */}
      <ItemList data-surface="sunken" className={DETAIL_PANEL}>
        {[0, 1, 2].map((row) => (
          <Item key={row} className="px-4">
            <Skeleton className="size-4" />
            <Skeleton className="size-10 rounded-control" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </Item>
        ))}
      </ItemList>
    </div>
  )
}
