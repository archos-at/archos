'use client'

import type { JSX } from 'react'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCardSkeleton } from '@/components/ui/stat-card'
import { cn } from '@/lib/utils'

export function HealthSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-6" aria-busy data-testid="answer-feedback-loading">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }, (_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
      <SkeletonCard lines={3} />
      <SkeletonCard block="h-40" />
      <div className="grid gap-6 md:grid-cols-2">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
      <SkeletonCard lines={3} />
    </div>
  )
}

function SkeletonCard({ lines = 0, block }: { lines?: number; block?: string }): JSX.Element {
  return (
    <Card aria-hidden>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {block ? <Skeleton className={cn('w-full', block)} /> : null}
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} className="h-5 w-full" />
        ))}
      </CardContent>
    </Card>
  )
}
