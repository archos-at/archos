'use client'

import { forwardRef } from 'react'
import { UserRound, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const MetaChip = forwardRef<
  HTMLButtonElement,
  {
    icon: typeof UserRound
    tone?: 'urgent'
    set?: boolean
    onClear?: () => void
    clearLabel?: string
    children: React.ReactNode
  } & React.ComponentProps<'button'>
>(function MetaChip({ icon: Icon, children, tone, set, onClear, clearLabel, ...props }, ref) {
  return (
    <span
      data-set={set || undefined}
      className={cn(
        'border-border/80 text-muted-foreground inline-flex h-6 max-w-full items-center rounded-full border text-[11px] font-medium transition-colors duration-quick ease-out',
        !set && 'border-dashed',
        set && 'bg-secondary text-foreground border-transparent',
        tone === 'urgent' && 'text-foreground border-foreground/50 border-solid font-medium'
      )}
    >
      <button
        ref={ref}
        type="button"
        className={cn(
          'hover:text-foreground inline-flex h-full min-w-0 items-center gap-1 rounded-full pl-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none',
          onClear ? 'pr-1' : 'pr-2'
        )}
        {...props}
      >
        <Icon className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{children}</span>
      </button>
      {onClear && (
        <button data-attr="files-clear"
          type="button"
          className="text-muted-foreground hover:text-foreground mr-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-label={clearLabel}
          onClick={onClear}
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </span>
  )
})
