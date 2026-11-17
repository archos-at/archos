'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'


import { cn, twMerge } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { useSheetPull } from '@/components/ui/sheet-pull'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { OVERLAY_MOTION } from '@/components/ui/overlay-motion'
import { focusPanelUnderFinger } from '@/components/ui/overlay-focus'

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const SCRIM_MOTION =
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 ' +
  OVERLAY_MOTION

const CARD_MOTION =
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 ' +
  OVERLAY_MOTION

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & {
    instant?: boolean
  }
>(({ className, instant = false, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="dialog-overlay"
    data-instant={instant || undefined}
    className={cn('bg-overlay fixed inset-0 z-50 backdrop-blur-sm', !instant && SCRIM_MOTION, className)}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

export type DialogMobilePresentation = 'sheet' | 'fullscreen' | 'none'

function phoneReach(className: string | undefined): string {
  return (className ?? '')
    .split(/\s+/)
    .flatMap((token) => {
      const match = /^(?:(?:max-sm|phone):)?([^:]+)$/.exec(token)
      return match ? [match[1]] : []
    })
    .join(' ')
}

const callerSets = (probe: string, reach: string): boolean => !twMerge(probe, reach).split(' ').includes(probe)

function unlessCallerSets(rules: ReadonlyArray<readonly [string, string]>, reach: string): string {
  return rules
    .filter(([, probe]) => !callerSets(probe, reach))
    .map(([cls]) => cls)
    .join(' ')
}

const GEOMETRY_PROBES = ['top-0', 'bottom-0', 'translate-y-0', 'h-0'] as const

const PHONE_SHEET_MOTION =
  'phone:data-[state=open]:slide-in-from-bottom phone:data-[state=open]:zoom-in-100 phone:data-[state=open]:fade-in-100 phone:data-[state=open]:duration-deliberate phone:data-[state=closed]:slide-out-to-bottom phone:data-[state=closed]:zoom-out-100 phone:data-[state=closed]:fade-out-100 phone:data-[state=closed]:duration-base'

const SHEET_GEOMETRY =
  'phone:top-auto phone:bottom-0 phone:translate-y-0 phone:max-h-[calc(100dvh-max(1.5rem,env(safe-area-inset-top)+0.75rem))] max-sm:max-w-none'

const SHEET_CHROME: ReadonlyArray<readonly [string, string]> = [
  ['phone:rounded-overlay', 'rounded-t-none'],
  ['phone:border-b-0', 'border-b-0'],
  ['max-sm:border-x-0', 'border-x-0'],
]

const FULLSCREEN_GEOMETRY =
  'phone:inset-0 phone:h-dvh phone:max-h-dvh phone:max-w-none phone:translate-x-0 phone:translate-y-0 phone:content-start'

const FULLSCREEN_CHROME: ReadonlyArray<readonly [string, string]> = [
  ['phone:rounded-none', 'rounded-none'],
  ['phone:border-0', 'border-0'],
  ['phone:pt-[max(1.5rem,env(safe-area-inset-top))]', 'pt-0'],
  ['phone:pl-[max(1rem,env(safe-area-inset-left))]', 'pl-0'],
  ['phone:pr-[max(1rem,env(safe-area-inset-right))]', 'pr-0'],
]

const PINNED_FOOTER =
  'phone:pb-[max(1.5rem,env(safe-area-inset-bottom))] ' +
  'phone:[:where(&_[data-slot=dialog-footer])]:sticky phone:[:where(&_[data-slot=dialog-footer])]:-bottom-[max(1.5rem,env(safe-area-inset-bottom))] ' +
  'phone:[:where(&_[data-slot=dialog-footer])]:z-[1] phone:[:where(&_[data-slot=dialog-footer])]:bg-popover ' +
  'phone:[:where(&_[data-slot=dialog-footer])]:pt-3 phone:[:where(&_[data-slot=dialog-footer])]:scroll-edge-bottom ' +
  'phone:[:where(&_[data-slot=dialog-footer])]:-mb-[max(1.5rem,env(safe-area-inset-bottom))] ' +
  'phone:[:where(&_[data-slot=dialog-footer])]:pb-[max(1rem,env(safe-area-inset-bottom))]'

const STICKY_TOP_SHEET = {
  chrome: 'phone:sticky phone:-top-6 phone:-mt-6 phone:-mx-6 phone:z-[2]',
  content:
    'phone:[&>:first-child]:row-start-1 phone:[&>:first-child]:col-start-1 ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child)]:sticky phone:[:where(&>[data-slot=dialog-header]:first-child)]:-top-6 ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child)]:z-[1] phone:[:where(&>[data-slot=dialog-header]:first-child)]:bg-popover ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child)]:-mx-6 phone:[:where(&>[data-slot=dialog-header]:first-child)]:-mt-6 ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child)]:-mb-3 phone:[:where(&>[data-slot=dialog-header]:first-child)]:pt-6 ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child)]:pb-3 phone:[:where(&>[data-slot=dialog-header]:first-child)]:pl-6 ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child)]:pr-6 phone:[:where(&>[data-slot=dialog-header]:first-child)]:scroll-edge-top ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child_[data-slot=dialog-title])]:pr-10 ' +
    'phone:[:where(&_[data-slot=dialog-footer])]:-mx-6 phone:[:where(&_[data-slot=dialog-footer])]:px-6',
} as const

const STICKY_TOP_FULLSCREEN = {
  chrome:
    'phone:sticky phone:-top-[max(1.5rem,env(safe-area-inset-top))] phone:-mt-[max(1.5rem,env(safe-area-inset-top))] ' +
    'phone:-ml-[max(1rem,env(safe-area-inset-left))] phone:-mr-[max(1rem,env(safe-area-inset-right))] phone:z-[2]',
  content:
    'phone:[&>:first-child]:row-start-1 phone:[&>:first-child]:col-start-1 ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child)]:sticky phone:[:where(&>[data-slot=dialog-header]:first-child)]:-top-[max(1.5rem,env(safe-area-inset-top))] ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child)]:z-[1] phone:[:where(&>[data-slot=dialog-header]:first-child)]:bg-popover ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child)]:-mt-[max(1.5rem,env(safe-area-inset-top))] phone:[:where(&>[data-slot=dialog-header]:first-child)]:pt-[max(1.5rem,env(safe-area-inset-top))] ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child)]:-ml-[max(1rem,env(safe-area-inset-left))] phone:[:where(&>[data-slot=dialog-header]:first-child)]:pl-[max(1rem,env(safe-area-inset-left))] ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child)]:-mr-[max(1rem,env(safe-area-inset-right))] phone:[:where(&>[data-slot=dialog-header]:first-child)]:pr-[max(1rem,env(safe-area-inset-right))] ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child_[data-slot=dialog-title])]:pr-14 ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child)]:-mb-3 phone:[:where(&>[data-slot=dialog-header]:first-child)]:pb-3 ' +
    'phone:[:where(&>[data-slot=dialog-header]:first-child)]:scroll-edge-top ' +
    'phone:[:where(&_[data-slot=dialog-footer])]:-ml-[max(1rem,env(safe-area-inset-left))] phone:[:where(&_[data-slot=dialog-footer])]:pl-[max(1rem,env(safe-area-inset-left))] ' +
    'phone:[:where(&_[data-slot=dialog-footer])]:-mr-[max(1rem,env(safe-area-inset-right))] phone:[:where(&_[data-slot=dialog-footer])]:pr-[max(1rem,env(safe-area-inset-right))]',
} as const

interface PhonePresentation {
  presentation: DialogMobilePresentation
  classes: string
  chrome: string
}

function phonePresentation(
  requested: DialogMobilePresentation,
  className: string | undefined,
  instant: boolean
): PhonePresentation {
  const reach = phoneReach(className)
  const presentation =
    requested === 'sheet' && GEOMETRY_PROBES.some((probe) => callerSets(probe, reach)) ? 'none' : requested
  if (presentation === 'none') return { presentation, classes: '', chrome: '' }
  const pinned = callerSets('pb-0', reach) ? '' : PINNED_FOOTER
  const ownTop =
    !callerSets('grid', reach) &&
    !callerSets('pt-0', reach) &&
    (presentation === 'sheet' || (!callerSets('pl-0', reach) && !callerSets('pr-0', reach)))
  const top = presentation === 'sheet' ? STICKY_TOP_SHEET : STICKY_TOP_FULLSCREEN
  const motion = instant ? '' : PHONE_SHEET_MOTION
  const classes =
    presentation === 'sheet'
      ? [SHEET_GEOMETRY, unlessCallerSets(SHEET_CHROME, reach), pinned, motion]
      : [FULLSCREEN_GEOMETRY, unlessCallerSets(FULLSCREEN_CHROME, reach), pinned, motion]
  if (ownTop) classes.push(top.content)
  return { presentation, classes: classes.join(' '), chrome: ownTop ? top.chrome : '' }
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    showCloseButton?: boolean
    mobilePresentation?: DialogMobilePresentation
    fullScreenOnMobile?: boolean
    closeLabel?: string
    instant?: boolean
  }
>(
  (
    {
      className,
      children,
      showCloseButton = true,
      mobilePresentation,
      fullScreenOnMobile = false,
      closeLabel,
      instant = false,
      onOpenAutoFocus,
      ...props
    },
    ref
  ) => {
    const t = useTranslations(commonCopy)
    const closeName = closeLabel ?? t('actions.close')
    const closeRef = React.useRef<HTMLButtonElement>(null)
    const dismiss = React.useCallback(() => closeRef.current?.click(), [])
    const pull = useSheetPull(dismiss)
    const {
      presentation,
      classes: phoneClasses,
      chrome,
    } = phonePresentation(
      mobilePresentation ?? (fullScreenOnMobile ? 'fullscreen' : 'sheet'),
      className,
      instant
    )
    const grabber = presentation === 'sheet' && showCloseButton

    return (
      <DialogPortal data-slot="dialog-portal">
        <DialogOverlay instant={instant} />
        <DialogPrimitive.Content
          ref={ref}
          data-slot="dialog-content"
          data-mobile-presentation={presentation}
          data-instant={instant || undefined}
          onOpenAutoFocus={(event) => {
            onOpenAutoFocus?.(event)
            focusPanelUnderFinger(event)
          }}
          className={cn(
            'bg-popover text-popover-foreground fixed left-[50%] top-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] grid-cols-1 gap-4 overflow-y-auto overscroll-contain rounded-overlay p-6 shadow-lg sm:max-w-lg',
            !instant && CARD_MOTION,
            phoneClasses,
            className
          )}
          {...props}
        >
          {children}
          {(grabber || showCloseButton) && (
            <div
              data-slot="dialog-chrome"
              className={cn(
                'absolute inset-x-0 top-0 z-[2] h-0',
                chrome && 'phone:row-start-1 phone:col-start-1 phone:self-start',
                chrome
              )}
            >
              {grabber && (
                <div
                  data-slot="dialog-grabber"
                  aria-hidden
                  className="phone:flex absolute inset-x-14 top-0 hidden h-6 cursor-grab touch-none select-none justify-center pt-2 active:cursor-grabbing"
                  {...pull}
                >
                  <span className="bg-muted-foreground/25 h-1 w-9 rounded-full" />
                </div>
              )}
              {showCloseButton && (
                <DialogPrimitive.Close
                  ref={closeRef}
                  data-slot="dialog-close"
                  className={cn(
                    'text-muted-foreground duration-quick hover:bg-hover hover:text-foreground pointer-coarse:size-11 pointer-coarse:top-2.5 pointer-coarse:right-2.5 absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-control outline-none transition-colors ease-out disabled:pointer-events-none disabled:opacity-50',
                    presentation === 'fullscreen' &&
                      'phone:top-[calc(env(safe-area-inset-top)+0.625rem)] phone:pointer-coarse:top-[max(0.625rem,calc(env(safe-area-inset-top)-0.875rem))] phone:right-[calc(env(safe-area-inset-right)+0.625rem)] phone:pointer-coarse:right-[calc(env(safe-area-inset-right)+0.625rem)]',
                    FOCUS_RING
                  )}
                >
                  <XIcon className="size-4" />
                  <span className="sr-only">{closeName}</span>
                </DialogPrimitive.Close>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    )
  }
)
DialogContent.displayName = DialogPrimitive.Content.displayName

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5 text-left', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-slot="dialog-title"
    className={cn('text-lg font-medium leading-none', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    data-slot="dialog-description"
    className={cn('text-muted-foreground text-sm', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
