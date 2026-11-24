'use client'

import { cn } from '@/lib/utils'

export function TrackBar({
  percent,
  sweeping,
  className,
  testId,
}: {
  percent: number | null
  sweeping: boolean
  className?: string
  testId?: string
}) {
  if (percent === null && !sweeping) return null

  return (
    <div
      data-testid={testId}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent === null ? {} : { 'aria-valuenow': percent })}
      className={cn('relative h-[3px] w-full overflow-hidden bg-foreground/8', className)}
    >
      {percent === null ? (
        <span className="animate-progress-sweep block h-full w-1/3 rounded-full bg-primary/60 motion-reduce:animate-none" />
      ) : (
        <span
          className="block h-full w-full origin-left rounded-r-full bg-primary transition-transform duration-quick ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${percent / 100})` }}
        />
      )}
    </div>
  )
}
