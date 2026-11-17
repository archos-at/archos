'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'

import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { motion, springGlide } from '@/components/motion'

const TabsValueContext = React.createContext<string | undefined>(undefined)

const TabsPillContext = React.createContext<string>('tabs-pill')

const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ className, value, defaultValue, onValueChange, children, ...props }, ref) => {
  const pillId = React.useId()
  const [uncontrolled, setUncontrolled] = React.useState<string | undefined>(defaultValue)
  const resolved = value !== undefined ? value : uncontrolled
  const handleValueChange = React.useCallback(
    (next: string) => {
      if (value === undefined) setUncontrolled(next)
      onValueChange?.(next)
    },
    [value, onValueChange]
  )
  return (
    <TabsPrimitive.Root
      ref={ref}
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      value={resolved}
      onValueChange={handleValueChange}
      {...props}
    >
      <TabsPillContext.Provider value={pillId}>
        <TabsValueContext.Provider value={resolved}>{children}</TabsValueContext.Provider>
      </TabsPillContext.Provider>
    </TabsPrimitive.Root>
  )
})
Tabs.displayName = TabsPrimitive.Root.displayName

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    data-slot="tabs-list"
    className={cn(
      'bg-desk text-foreground/70 inline-flex h-9 w-fit items-center justify-center rounded-control p-1 pointer-coarse:h-auto',
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, value, children, ...props }, ref) => {
  const activeValue = React.useContext(TabsValueContext)
  const pillId = React.useContext(TabsPillContext)
  const isActive = value !== undefined && activeValue === value
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      value={value}
      data-slot="tabs-trigger"
      data-focus-inset=""
      data-attr={value === undefined ? undefined : `tab-${value}`}
      className={cn(
        'data-[state=active]:text-foreground data-[state=inactive]:hover:bg-hover data-[state=inactive]:hover:text-foreground outline-none relative isolate inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-control px-3.5 py-1 text-sm font-medium whitespace-nowrap transition-[color,background-color,scale] [transition-duration:var(--motion-quick),var(--motion-quick),var(--motion-snap)] ease-out motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 pointer-coarse:min-h-11 active:scale-[0.98] motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
        FOCUS_RING,
        'focus-visible:ring-inset focus-visible:ring-offset-0',
        className
      )}
      {...props}
    >
      {isActive && (
        <motion.span
          layoutId={pillId}
          aria-hidden
          data-slot="tabs-pill"
          data-pill-id={pillId}
          className="bg-sheet shadow-thumb absolute inset-0 -z-10 rounded-[inherit]"
          transition={springGlide}
        />
      )}
      {children}
    </TabsPrimitive.Trigger>
  )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    data-slot="tabs-content"
    className={cn('flex-1 outline-none', className)}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
