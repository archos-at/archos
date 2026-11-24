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
