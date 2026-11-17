import type { ComponentProps, JSX } from 'react'
import { forwardRef } from 'react'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { cn } from '@/lib/utils'

export const PageSheet = forwardRef<HTMLDivElement, ComponentProps<'div'>>(function PageSheet(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="page-sheet"
      className={cn(
        'relative shrink-0 bg-white shadow-sm ring-1 ring-border contrast-more:ring-foreground/50',
        className,
      )}
      {...props}
    />
  )
})

export function PageThumbnailButton({
  current,
  number,
  className,
  children,
  ...props
}: ComponentProps<'button'> & { current: boolean; number: number }): JSX.Element {
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      className={cn(
        'group/thumb flex w-full shrink-0 flex-col items-center gap-1 rounded-md p-1.5 outline-none',
        'hover:bg-hover transition-colors duration-quick ease-out',
        FOCUS_RING,
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'block w-full ring-offset-2 ring-offset-surface-sunken',
          current && 'ring-2 ring-ring/60 contrast-more:ring-foreground',
        )}
      >
        {children}
      </span>
      <span
        aria-hidden
        className={cn(
          'text-[11px] leading-none tabular-nums',
          current ? 'text-foreground font-medium' : 'text-muted-foreground contrast-more:text-foreground',
        )}
      >
        {number}
      </span>
    </button>
  )
}
