import type { JSX } from 'react'
import type { ComponentProps } from 'react'
import { forwardRef } from 'react'
import { ButtonGroup } from '@/components/ui/button-group'
import { Button } from '@/components/ui/button'
import { FIELD_FOCUS_RING } from '@/components/ui/focus-ring'
import { cn } from '@/lib/utils'

export function FloatingToolbar({ className, ...props }: ComponentProps<typeof ButtonGroup>): JSX.Element {
  return (
    <ButtonGroup
      data-slot="floating-toolbar"
      className={cn(
        'border-transparent bg-popover/95 gap-0.5 shadow-md backdrop-blur-md',
        'contrast-more:bg-popover contrast-more:border-foreground/40',
        className,
      )}
      {...props}
    />
  )
}

export function ToolbarIconButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size'>): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        'text-muted-foreground hover:text-foreground size-7 shrink-0 rounded-control [&_svg]:size-3.5 pointer-coarse:size-11',
        'aria-pressed:bg-accent aria-pressed:text-foreground contrast-more:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function ToolbarTextButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size'>): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        'text-muted-foreground hover:text-foreground h-7 shrink-0 rounded-control px-1.5 text-xs font-normal tabular-nums pointer-coarse:h-11',
        'contrast-more:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function ToolbarText({ className, ...props }: ComponentProps<'span'>): JSX.Element {
  return (
    <span
      data-slot="toolbar-text"
      className={cn(
        'text-muted-foreground contrast-more:text-foreground px-1.5 text-xs whitespace-nowrap tabular-nums',
        className,
      )}
      {...props}
    />
  )
}

export function ToolbarDivider({ className, ...props }: ComponentProps<'span'>): JSX.Element {
  return (
    <span
      aria-hidden
      data-slot="toolbar-divider"
      className={cn('bg-border contrast-more:bg-foreground/40 mx-0.5 h-4 w-px shrink-0', className)}
      {...props}
    />
  )
}

export const ToolbarField = forwardRef<HTMLInputElement, ComponentProps<'input'>>(function ToolbarField(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      data-slot="toolbar-field"
      className={cn(
        'border-input bg-input-background text-foreground placeholder:text-muted-foreground h-7 min-w-0 rounded-control border px-2 text-xs tabular-nums outline-none',
        'pointer-coarse:h-11 pointer-coarse:text-base',
        FIELD_FOCUS_RING,
        className,
      )}
      {...props}
    />
  )
})

export function FloatingNote({ className, ...props }: ComponentProps<'p'>): JSX.Element {
  return (
    <p
      data-slot="floating-note"
      className={cn(
        'bg-popover/95 text-muted-foreground flex max-w-full min-w-0 items-center gap-1.5 rounded-surface px-2.5 py-1.5 text-xs shadow-md backdrop-blur-md',
        'contrast-more:bg-popover contrast-more:border contrast-more:border-foreground/40 contrast-more:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  )
}
