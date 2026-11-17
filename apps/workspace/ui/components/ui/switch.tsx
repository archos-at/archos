'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { springSnapLinear, springSnapLinearDuration } from '@/components/motion'

const THUMB_SPRING: React.CSSProperties = {
  transitionTimingFunction: springSnapLinear,
  transitionDuration: springSnapLinearDuration,
}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    data-slot="switch"
    className={cn(
      'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input data-[state=unchecked]:hover:bg-foreground/20 data-[state=unchecked]:border-strong inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-transparent transition-[color,background-color,border-color,opacity,scale] [transition-duration:var(--motion-quick),var(--motion-quick),var(--motion-quick),var(--motion-quick),var(--motion-snap)] ease-out outline-none disabled:cursor-not-allowed disabled:opacity-50 touch-target active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100',
      FOCUS_RING,
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      data-slot="switch-thumb"
      style={THUMB_SPRING}
      className={cn(
        'pointer-events-none block size-5 rounded-full bg-background shadow-sm dark:data-[state=unchecked]:bg-muted-foreground ring-0 transition-transform duration-quick ease-out data-[state=checked]:translate-x-[1.125rem] data-[state=unchecked]:translate-x-0.5 motion-reduce:transition-none'
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName

export { Switch }
