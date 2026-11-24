'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function RowAction({
  label,
  onClick,
  icon: Icon,
  className,
}: {
  label: string
  onClick: () => void
  icon: typeof X
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:size-11',
        className
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  )
}
