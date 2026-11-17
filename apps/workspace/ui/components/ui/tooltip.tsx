'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@/lib/utils'
import { OVERLAY_REDUCED } from '@/components/ui/overlay-motion'

export const TOOLTIP_OPEN_DELAY_MS = 300

export const TOOLTIP_SKIP_DELAY_MS = 300

const TooltipProviderScope = React.createContext(false)

function TooltipProvider({
  delayDuration = TOOLTIP_OPEN_DELAY_MS,
  skipDelayDuration = TOOLTIP_SKIP_DELAY_MS,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipProviderScope.Provider value>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
        {...props}
      />
    </TooltipProviderScope.Provider>
  )
}

function InheritedTooltipProvider({ children }: { children: React.ReactNode }) {
  const scoped = React.useContext(TooltipProviderScope)
  return scoped ? children : <TooltipProvider>{children}</TooltipProvider>
}

const Tooltip = ({ ...props }: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>) => (
  <InheritedTooltipProvider>
    <TooltipPrimitive.Root data-slot="tooltip" {...props} />
  </InheritedTooltipProvider>
)

interface ToggletipControl {
  open: boolean
  setOpen: (open: boolean) => void
  openAtPress: React.MutableRefObject<boolean>
}

const ToggletipContext = React.createContext<ToggletipControl | null>(null)

function Toggletip({
  defaultOpen = false,
  children,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>, 'open' | 'onOpenChange'>) {
  const [open, setOpen] = React.useState(defaultOpen)
  const openAtPress = React.useRef(false)
  const control = React.useMemo<ToggletipControl>(() => ({ open, setOpen, openAtPress }), [open])
  return (
    <InheritedTooltipProvider>
      <TooltipPrimitive.Root data-slot="toggletip" open={open} onOpenChange={setOpen} {...props}>
        <ToggletipContext.Provider value={control}>{children}</ToggletipContext.Provider>
      </TooltipPrimitive.Root>
    </InheritedTooltipProvider>
  )
}

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(({ onFocus, onPointerDown, onClick, ...props }, ref) => {
  const toggletip = React.useContext(ToggletipContext)
  const pressedBy = React.useRef<string | null>(null)
  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      data-slot="tooltip-trigger"
      onFocus={(event) => {
        onFocus?.(event)
        if (!isFocusVisible(event.currentTarget)) event.preventDefault()
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        pressedBy.current = event.pointerType
        if (toggletip) toggletip.openAtPress.current = toggletip.open
      }}
      onClick={(event) => {
        onClick?.(event)
        const pointer = pressedBy.current
        pressedBy.current = null
        if (!toggletip || pointer === 'mouse') return
        event.preventDefault()
        const wasOpen = pointer === null ? toggletip.open : toggletip.openAtPress.current
        toggletip.setOpen(!wasOpen)
      }}
      {...props}
    />
  )
})
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName

function isFocusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    return true
  }
}

const TOOLTIP_MOTION =
  'data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 ' +
  'data-[state=delayed-open]:duration-quick data-[state=delayed-open]:ease-entrance ' +
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 ' +
  'data-[state=closed]:duration-snap data-[state=closed]:ease-exit ' +
  OVERLAY_REDUCED

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      data-slot="tooltip-content"
      sideOffset={sideOffset}
      className={cn(
        'bg-foreground text-background z-50 w-fit max-w-(--radix-tooltip-content-available-width) origin-(--radix-tooltip-content-transform-origin) rounded-control px-3 py-1.5 text-xs font-medium text-balance shadow-xs',
        TOOLTIP_MOTION,
        className
      )}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45" />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Toggletip, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
