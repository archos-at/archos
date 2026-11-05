import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'

import { cn } from '@/lib/utils'
import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'

function Item({
  className,
  asChild = false,
  as: CompProp = 'div',
  ref,
  ...props
}: React.HTMLAttributes<HTMLElement> & { asChild?: boolean; as?: 'div' | 'li'; ref?: React.Ref<HTMLElement> }): React.JSX.Element {
  const Comp = asChild ? Slot : CompProp
  return (
    <Comp
      // The element is a `div`, an `li` or the child; each is an HTMLElement, which is all a caller's ref is promised.
      ref={ref as React.Ref<HTMLDivElement & HTMLLIElement>}
      data-slot="item"
      className={cn(
        // A row is `px-4 py-3` — the design language's list-row padding.
        'flex items-center gap-3 px-4 py-3 text-left transition-colors duration-snap ease-out hover:bg-accent/40 motion-reduce:transition-none',
        // Keyboard focus must not be the same pixel as hover. It used to be
        // exactly that — `outline-none` plus the hover background — so a
        // keyboard reader could not tell which row they were on when the
        // pointer happened to rest on another. The ring is inset because
        // `ItemList` clips (`overflow-hidden`) and an offset ring on the first
        // or last row would be sliced off by its rounded edge.
        'outline-none',
        FOCUS_RING_INSET,
        // A row is routinely `asChild` an anchor, and an anchor cannot take
        // `disabled` — so the aria mirror carries the same treatment.
        'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
        // THE PRESS, for a row that is a control (`asChild` a link or a
        // button). A tint one step past the hover, on the same snap, and NOT
        // the `PRESSABLE` scale: a row is connected to its neighbours, and a
        // full-width row shrinking 2% pulls its edges off the hairlines above
        // and below it, the detachment the hover-without-lift rule exists to
        // prevent. A plain `div` row is gated out, since `:active` fires on
        // any element under a held pointer.
        '[&:is(a,button)]:active:bg-accent/70',
        // THE SELECTED ROW of a list whose detail is open beside it (a
        // two-pane inbox, the E-Mail-Eingang): `aria-current="true"` on the
        // row, or `data-current` where the row's link carries `aria-current`
        // itself. It lifts to the card and draws the selected hairline all
        // round, inset. Not a tint: muted text on `bg-accent/70` measured
        // 4.33:1 (axe, 2026-10-22), under AA. Not a bar down its leading
        // edge: that is the stripe the design language retired (2026-10-27).
        // Last in the cascade's variant order, so the hover never repaints it.
        'aria-[current=true]:bg-card aria-[current=true]:inset-ring aria-[current=true]:inset-ring-strong',
        'data-current:bg-card data-current:inset-ring data-current:inset-ring-strong',
        // THE KEYBOARD'S ROW of a list walked with J/K while the focus stays
        // where it is (`data-cursor`): the keyboard's own ring, inset, so the
        // pointer resting on another row never matches it.
        'data-cursor:inset-ring-2 data-cursor:inset-ring-ring/60',
        className,
      )}
      {...props}
    />
  )
}

function ItemMedia({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="item-media"
      className={cn('flex size-8 shrink-0 items-center justify-center', className)}
      {...props}
    />
  )
}

function ItemContent({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="item-content" className={cn('min-w-0 flex-1', className)} {...props} />
}

function ItemTitle({ className, ...props }: React.ComponentProps<'p'>): React.JSX.Element {
  return (
    <p
      data-slot="item-title"
      className={cn('truncate text-sm font-medium text-foreground', className)}
      {...props}
    />
  )
}

function ItemDescription({ className, ...props }: React.ComponentProps<'p'>): React.JSX.Element {
  return (
    <p
      data-slot="item-description"
      className={cn('truncate text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function ItemActions({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="item-actions"
      className={cn('ml-auto flex shrink-0 items-center gap-2', className)}
      {...props}
    />
  )
}

/**
 * `ol` is here because a version history is an ordered list and the list is the
 * order: the document-lifecycle panel renders its versions newest-first, and
 * rendering that as a `ul` would drop the ordinality from the accessibility
 * tree while the eye still reads it off the page.
 */
function ItemList({
  className,
  as: Comp = 'div',
  ...props
}: React.HTMLAttributes<HTMLElement> & { as?: 'div' | 'ul' | 'ol' }): React.JSX.Element {
  return (
    <Comp
      data-slot="item-list"
      className={cn('overflow-hidden rounded-surface border divide-y', className)}
      {...props}
    />
  )
}

export { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions, ItemList }
