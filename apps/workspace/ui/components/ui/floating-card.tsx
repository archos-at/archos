import type { ComponentProps, JSX } from 'react'
import { cn } from '@/lib/utils'

/**
 * A small card that floats over content in the toolbar's material and, unlike
 * {@link FloatingNote}, holds more than one line and may hold actions: the
 * reading beside a measurement on a sheet, with "keep" under it.
 *
 * The popover plane, translucent and blurred for the reason the toolbar is: what
 * lies under it is the reader's drawing, and its linework must not cut through
 * the words. Under `prefers-contrast: more` it goes opaque with an ink hairline.
 * Sized by its content up to a narrow measure, so it never covers the detail it
 * speaks about.
 */
export function FloatingCard({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      data-slot="floating-card"
      className={cn(
        'border-base bg-popover/95 text-foreground flex w-max max-w-[17rem] min-w-0 flex-col gap-1.5 rounded-surface border px-3 py-2.5 text-xs shadow-md backdrop-blur-md',
        'contrast-more:bg-popover contrast-more:border-foreground/40',
        className
      )}
      {...props}
    />
  )
}

/** The card's headline: one number or one short statement, in ink, tabular so a value that updates does not jump. */
export function FloatingCardTitle({ className, ...props }: ComponentProps<'p'>): JSX.Element {
  return (
    <p
      data-slot="floating-card-title"
      className={cn('text-foreground text-sm leading-5 font-semibold tabular-nums', className)}
      {...props}
    />
  )
}

/** The row of actions under the card's lines. */
export function FloatingCardActions({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return <div data-slot="floating-card-actions" className={cn('flex items-center gap-1.5 pt-0.5', className)} {...props} />
}
