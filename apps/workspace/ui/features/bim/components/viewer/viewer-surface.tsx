'use client'

import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface ViewerSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'raised' | 'flat'
}

export const ViewerSurface = forwardRef<HTMLDivElement, ViewerSurfaceProps>(
  function ViewerSurface({ className, tone = 'raised', ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="viewer-surface"
        className={cn(
          'rounded-2xl',
          tone === 'raised'
            ? 'bg-card/80 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-card/70'
            : 'bg-transparent',
          className
        )}
        {...props}
      />
    )
  }
)
