import type { FC } from 'react'

import { cn } from '@/lib/utils'

export const ShimmerText: FC<{ children: string; active?: boolean; className?: string }> = ({
  children,
  active = true,
  className,
}) => (
  <span className={cn('relative inline-block max-w-full overflow-hidden align-top', className)}>
    <span className={cn('block truncate', active && 'text-muted-foreground motion-reduce:text-inherit')}>
      {children}
    </span>
    {active && (
      <span
        aria-hidden="true"
        className="animate-shimmer-window pointer-events-none absolute inset-y-0 left-0 w-1/2 overflow-hidden motion-reduce:hidden"
      >
        <span
          data-text={children}
          className="animate-shimmer-copy text-foreground block w-[200%] truncate before:content-[attr(data-text)]"
        />
      </span>
    )}
  </span>
)
