'use client'

import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { CheckIcon, MinusIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { PRESSABLE_SMALL } from '@/components/ui/press'

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    data-slot="checkbox"
    className={cn(
      'peer border-(--ds-line-strong) dark:bg-input-background data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary size-4 shrink-0 rounded-inline border outline-none disabled:cursor-not-allowed disabled:opacity-50 touch-target',
      PRESSABLE_SMALL,
      'dark:data-[state=checked]:bg-primary dark:data-[state=checked]:text-primary-foreground',
      'data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary',
      'dark:data-[state=indeterminate]:bg-primary dark:data-[state=indeterminate]:text-primary-foreground',
      'data-[state=unchecked]:hover:bg-hover',
      FOCUS_RING,
      'aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      data-slot="checkbox-indicator"
      forceMount
      className={cn(
        'group/indicator flex items-center justify-center text-current',
        'transition-[opacity,scale] duration-snap ease-out motion-reduce:transition-none',
        'data-[state=unchecked]:scale-90 data-[state=unchecked]:opacity-0'
      )}
    >
      {/* The indicator carries the root's `data-state`, so one of the two glyphs shows. */}
      <CheckIcon data-slot="checkbox-check" className="size-3.5 group-data-[state=indeterminate]/indicator:hidden" />
      <MinusIcon data-slot="checkbox-dash" className="hidden size-3.5 group-data-[state=indeterminate]/indicator:block" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
