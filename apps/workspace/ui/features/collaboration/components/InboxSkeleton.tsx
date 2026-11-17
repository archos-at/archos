import type { JSX } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

export function InboxQueueSkeleton(): JSX.Element {
  return (
    <div className="space-y-4 px-2" aria-busy="true" data-testid="inbox-queue-skeleton">
      <Skeleton className="h-3 w-28" />
      {[0, 1, 2].map((index) => (
        <div key={index} className="space-y-1.5">
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

export function InboxSheetSkeleton(): JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" aria-hidden>
      <div className="w-full px-4 pt-6 md:px-8">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <div className="flex min-h-8 items-center">
            <Skeleton className="h-8 w-56 rounded-control" />
          </div>
          <InboxQueueSkeleton />
        </div>
      </div>
    </div>
  )
}
