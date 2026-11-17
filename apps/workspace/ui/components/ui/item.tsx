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
      ref={ref as React.Ref<HTMLDivElement & HTMLLIElement>}
      data-slot="item"
      className={cn(
        'flex items-center gap-3 px-4 py-3 text-left transition-colors duration-snap ease-out hover:bg-hover motion-reduce:transition-none',
        'outline-none',
        FOCUS_RING_INSET,
        'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
        '[&:is(a,button)]:active:bg-selected',
        'aria-[current=true]:bg-card aria-[current=true]:inset-ring aria-[current=true]:inset-ring-strong',
        'data-current:bg-card data-current:inset-ring data-current:inset-ring-strong',
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
