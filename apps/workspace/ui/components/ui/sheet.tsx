'use client'

import type { JSX } from 'react'
import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { OVERLAY_MOTION, OVERLAY_EXIT, OVERLAY_REDUCED } from '@/components/ui/overlay-motion'
import { focusPanelUnderFinger } from '@/components/ui/overlay-focus'

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close
const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-overlay backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 '
        + OVERLAY_MOTION,
      className,
    )}
    {...props}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const SIDE_CLASSES = {
  right:
    'inset-y-0 right-0 h-full w-full border-l pt-[max(1.5rem,env(safe-area-inset-top))] pr-[max(1.5rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-md',
  left: 'inset-y-0 left-0 h-full w-full border-r pt-[max(1.5rem,env(safe-area-inset-top))] pl-[max(1.5rem,env(safe-area-inset-left))] pb-[max(1.5rem,env(safe-area-inset-bottom))] data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-md',
  bottom:
    'inset-x-0 bottom-0 max-h-[90dvh] border-t pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
} as const

const CLOSE_SIDE_CLASSES = {
  right: 'top-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] right-[max(1rem,calc(env(safe-area-inset-right)+0.5rem))]',
  left: 'top-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))]',
  bottom: 'right-[max(1rem,calc(env(safe-area-inset-right)+0.5rem))]',
} as const

export type SheetSide = keyof typeof SIDE_CLASSES

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> {
  side?: SheetSide
  closeLabel?: string
}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ className, children, side = 'right', closeLabel, style, onOpenAutoFocus, ...props }, ref) => {
    const t = useTranslations(commonCopy)
    return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        style={style}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event)
          focusPanelUnderFinger(event)
        }}
        className={cn(
          'fixed z-50 flex flex-col gap-4 overflow-y-auto bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out '
            + 'data-[state=open]:ease-entrance data-[state=open]:duration-deliberate '
            + `${OVERLAY_EXIT} ${OVERLAY_REDUCED}`,
          SIDE_CLASSES[side],
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          className={cn(
            'absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-control text-muted-foreground outline-none transition-colors duration-quick ease-out hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none touch-target',
            CLOSE_SIDE_CLASSES[side],
            FOCUS_RING,
          )}
        >
          <X className="size-4" aria-hidden />
          <span className="sr-only">{closeLabel ?? t('actions.close')}</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
    )
  },
)
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element => (
  <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />
)
SheetHeader.displayName = 'SheetHeader'

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element => (
  <div className={cn('mt-auto flex flex-col gap-2 sm:flex-row sm:justify-end', className)} {...props} />
)
SheetFooter.displayName = 'SheetFooter'

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn('text-lg font-medium', className)} {...props} />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
}
