import * as React from 'react'

import { cn } from '@/lib/utils'

const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="skeleton"
      className={cn(
        'bg-secondary animate-skeleton-shimmer rounded-control motion-reduce:animate-none',
        className
      )}
      {...props}
    />
  )
)
Skeleton.displayName = 'Skeleton'

export { Skeleton }
