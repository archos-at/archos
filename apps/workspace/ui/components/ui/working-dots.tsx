import type { JSX } from 'react'
import { cn } from '@/lib/utils'

export function WorkingDots({ className, label }: { className?: string; label?: string }): JSX.Element {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('inline-flex items-center gap-0.5', className)}
    >
      {[0, 1, 2].map((dot) => (
        <span key={dot} className="animate-typing-dot size-1 rounded-full bg-current motion-reduce:animate-none" />
      ))}
    </span>
  )
}
