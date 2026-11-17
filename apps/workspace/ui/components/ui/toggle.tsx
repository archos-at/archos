'use client'

import * as React from 'react'
import * as TogglePrimitive from '@radix-ui/react-toggle'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/ui/focus-ring'

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-control text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,opacity,scale] [transition-duration:var(--motion-quick),var(--motion-quick),var(--motion-quick),var(--motion-quick),var(--motion-snap)] ease-out outline-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 motion-reduce:transition-none active:scale-[0.98] motion-reduce:active:scale-100 " +
    FOCUS_RING,
  {
    variants: {
      variant: {
        default: 'bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground',
        outline:
          'border border-border bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground data-[state=on]:border-border data-[state=on]:bg-card data-[state=on]:font-medium data-[state=on]:text-foreground',
        inverted:
          'text-muted-foreground hover:bg-hover hover:text-foreground data-[state=on]:bg-foreground data-[state=on]:text-background data-[state=on]:shadow-2xs',
        chip: 'rounded-full bg-desk text-foreground font-medium hover:bg-selected data-[state=on]:bg-selected data-[state=on]:hover:bg-pressed',
      },
      size: {
        default: 'h-9 px-3 text-sm pointer-coarse:h-11 pointer-coarse:min-w-11',
        sm: 'h-8 px-3 text-xs pointer-coarse:h-11 pointer-coarse:min-w-11',
        lg: 'h-10 px-3.5 pointer-coarse:h-11 pointer-coarse:min-w-11',
        icon: 'size-8 pointer-coarse:size-11',
        'icon-sm': 'size-7 px-0 pointer-coarse:size-11',
      },
    },
    compoundVariants: [
      {
        variant: 'chip',
        className:
          'relative h-7 px-3 pointer-coarse:h-9 pointer-coarse:min-w-11 after:absolute after:-inset-y-1 after:inset-x-0 after:content-[""]',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    data-slot="toggle"
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
))
Toggle.displayName = TogglePrimitive.Root.displayName

export { Toggle, toggleVariants }
