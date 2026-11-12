/**
 * The inbox's loading shapes, without a hook in them so a route's `loading.tsx`
 * (a server file) can draw them too.
 *
 * One shape from the click to the rows: the sheet's skeleton holds
 * `InboxSheetSkeleton`, the list that replaces it starts on „Für mich“ with
 * `InboxQueueSkeleton` at the same place, and the queue settles there. The
 * sheet used to show three blocks, the list a second skeleton of another shape
 * under a toolbar that had just appeared, and then the rows: three pictures of
 * one wait.
 */

import type { JSX } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

/** The queue while it reads: a heading, then entries of a title and its line. */
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

/**
 * The inbox sheet's body while its route resolves: the sheet's own padding
 * (`inbox-sheet.tsx`), the list's reading measure and toolbar line
 * (`InboxList`), and the queue's skeleton under it.
 */
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
