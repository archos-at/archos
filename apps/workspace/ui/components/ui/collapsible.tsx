'use client'

import * as React from 'react'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'

import { cn } from '@/lib/utils'

const OpenContext = React.createContext(false)

const Collapsible = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Root>
>(({ open: openProp, defaultOpen = false, onOpenChange, ...props }, ref) => {
  const [inner, setInner] = React.useState(defaultOpen)
  const open = openProp ?? inner
  return (
    <OpenContext.Provider value={open}>
      <CollapsiblePrimitive.Root
        ref={ref}
        open={open}
        onOpenChange={(next) => {
          setInner(next)
          onOpenChange?.(next)
        }}
        {...props}
      />
    </OpenContext.Provider>
  )
})
Collapsible.displayName = CollapsiblePrimitive.Root.displayName

const CollapsibleTrigger = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.CollapsibleTrigger>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleTrigger>
>((props, ref) => {
  const open = React.useContext(OpenContext)
  return <CollapsiblePrimitive.CollapsibleTrigger ref={ref} {...(open ? {} : { 'aria-controls': undefined })} {...props} />
})
CollapsibleTrigger.displayName = CollapsiblePrimitive.CollapsibleTrigger.displayName

const CollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.CollapsibleContent>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleContent>
>(({ className, ...props }, ref) => (
  <CollapsiblePrimitive.CollapsibleContent
    ref={ref}
    data-slot="collapsible-content"
    className={cn(
      'motion-reduce:animate-none',
      className
    )}
    {...props}
  />
))
CollapsibleContent.displayName = CollapsiblePrimitive.CollapsibleContent.displayName

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
