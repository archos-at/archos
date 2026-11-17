import * as React from 'react'

import { cn } from '@/lib/utils'

export function Listbox({ className, ...props }: React.ComponentProps<'ul'>): React.JSX.Element {
  return (
    <ul
      role="listbox"
      data-slot="listbox"
      className={cn('bg-popover text-popover-foreground max-h-64 overflow-y-auto rounded-surface p-1 shadow-xs', className)}
      {...props}
    />
  )
}

export interface ListboxOptionProps extends Omit<React.ComponentProps<'li'>, 'onSelect'> {
  active?: boolean
  selected?: boolean
  onChoose?: () => void
}

export function ListboxOption({
  active = false,
  selected = false,
  onChoose,
  className,
  onMouseDown,
  ...props
}: ListboxOptionProps): React.JSX.Element {
  return (
    <li
      role="option"
      aria-selected={selected}
      data-slot="listbox-option"
      data-active={active || undefined}
      className={cn(
        'flex min-h-9 cursor-pointer flex-col justify-center rounded-control px-2.5 py-1.5 text-sm pointer-coarse:min-h-11',
        'data-[active]:bg-hover data-[active]:text-accent-foreground hover:bg-hover',
        className
      )}
      onMouseDown={(event) => {
        event.preventDefault()
        onMouseDown?.(event)
        onChoose?.()
      }}
      {...props}
    />
  )
}
