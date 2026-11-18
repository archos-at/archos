'use client'

import type { JSX } from 'react'
import { ItemList } from '@/components/ui/item'
import { LoadError } from '@/components/ui/load-error'
import { Skeleton } from '@/components/ui/skeleton'

export function ListSkeleton(): JSX.Element {
  return (
    <ItemList aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </ItemList>
  )
}

export function TimelineSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Skeleton className="h-4 w-48" />
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  )
}

export function ErrorAlert({
  title,
  onRetry,
  busy,
}: {
  title: string
  onRetry: () => void
  busy: boolean
}): JSX.Element {
  return <LoadError title={title} onRetry={onRetry} retrying={busy} />
}
