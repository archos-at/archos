'use client'

import type { JSX } from 'react'
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import {
  AnimatePresence,
  motion,
  motionEntrance,
  motionSheetEnter,
  motionSheetExit,
  springGlide,
} from '@/components/motion'
import { useDragControls, type PanInfo } from 'motion/react'
import { pullDismisses } from '@/components/ui/sheet-pull'

export const PAGE_SHEET_OVERLAY_CLASS = 'bg-overlay fixed inset-0 z-50 backdrop-blur-sm'
export const PAGE_SHEET_PANEL_CLASS =
  'bg-background fixed inset-x-0 bottom-0 top-[max(0.75rem,env(safe-area-inset-top))] z-50 flex flex-col overflow-hidden rounded-surface pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-xl outline-none md:inset-x-5 md:top-5 md:mx-auto [--shell-inset-bottom:env(safe-area-inset-bottom)]'

const PANEL_WIDTH = 'md:max-w-[1400px]'

interface PageSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  subtitle?: string
  closeLabel: string
  headerActions?: React.ReactNode
  headerless?: boolean
  initialFocusRef?: React.RefObject<HTMLElement | null>
  enterFrom?: { y: number; scrim: number }
  onExitComplete?: () => void
  bodyClassName?: string
  children: React.ReactNode
}

export function PageSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  closeLabel,
  headerActions,
  headerless = false,
  initialFocusRef,
  enterFrom,
  onExitComplete,
  bodyClassName,
  children,
}: PageSheetProps): JSX.Element {
  const dragControls = useDragControls()
  const pulledRef = React.useRef(false)

  const startDrag = React.useCallback(
    (event: React.PointerEvent) => {
      const target = event.target as HTMLElement
      pulledRef.current = false
      const onGrabber = target.closest('[data-slot="page-sheet-grabber"]') !== null
      if (!onGrabber && target.closest('button, a, input, select, textarea, [role="button"]')) return
      dragControls.start(event)
    },
    [dragControls]
  )

  const handleDragEnd = React.useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (pullDismisses(info.offset.y, info.velocity.y)) onOpenChange(false)
    },
    [onOpenChange]
  )

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence onExitComplete={onExitComplete}>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className={PAGE_SHEET_OVERLAY_CLASS}
                initial={{ opacity: enterFrom?.scrim ?? 0 }}
                animate={{ opacity: 1, transition: motionEntrance }}
                exit={{ opacity: 0, transition: motionSheetExit }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              asChild
              forceMount
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                if (initialFocusRef) initialFocusRef.current?.focus()
                else (event.currentTarget as HTMLElement | null)?.focus()
              }}
            >
              <motion.div
                className={cn(PAGE_SHEET_PANEL_CLASS, PANEL_WIDTH)}
                initial={{ y: enterFrom?.y ?? '100%' }}
                animate={{ y: 0, transition: motionSheetEnter }}
                exit={{ y: '100%', transition: motionSheetExit }}
                drag="y"
                dragListener={false}
                dragControls={dragControls}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 1 }}
                dragTransition={{
                  bounceStiffness: springGlide.stiffness,
                  bounceDamping: springGlide.damping,
                }}
                onDragStart={() => {
                  pulledRef.current = true
                }}
                onDragEnd={handleDragEnd}
              >
                <PageSheetGrabber label={closeLabel} onPointerDown={startDrag} pulledRef={pulledRef} />
                {headerless ? (
                  <>
                    <DialogPrimitive.Title data-slot="page-sheet-title" className="sr-only">
                      {title}
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="sr-only">
                      {subtitle ?? title}
                    </DialogPrimitive.Description>
                  </>
                ) : (
                  <header
                    className="border-border flex shrink-0 cursor-grab touch-none items-start justify-between gap-4 border-b px-4 pb-4 pt-2 select-none active:cursor-grabbing pointer-coarse:pt-0 md:px-8 md:pb-5 md:pt-3"
                    onPointerDown={startDrag}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <DialogPrimitive.Title
                        data-slot="page-sheet-title"
                        className="text-foreground truncate text-lg font-medium"
                      >
                        {title}
                      </DialogPrimitive.Title>
                      {subtitle ? (
                        <DialogPrimitive.Description className="text-muted-foreground line-clamp-2 text-sm text-pretty md:line-clamp-1">
                          {subtitle}
                        </DialogPrimitive.Description>
                      ) : (
                        <DialogPrimitive.Description className="sr-only">
                          {title}
                        </DialogPrimitive.Description>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {headerActions}
                      <PageSheetClose label={closeLabel} />
                    </div>
                  </header>
                )}
                <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}

function PageSheetGrabber({
  label,
  onPointerDown,
  pulledRef,
}: {
  label: string
  onPointerDown: (event: React.PointerEvent) => void
  pulledRef: React.RefObject<boolean>
}): JSX.Element {
  return (
    <div
      data-slot="page-sheet-grabber"
      className="flex shrink-0 cursor-grab touch-none justify-center py-2 select-none active:cursor-grabbing pointer-coarse:py-0"
      onPointerDown={onPointerDown}
    >
      <DialogPrimitive.Close
        data-slot="page-sheet-grabber-close"
        onClick={(event) => {
          if (pulledRef.current) event.preventDefault()
        }}
        className={cn(
          'flex h-4 w-14 cursor-grab items-center justify-center rounded-control outline-none active:cursor-grabbing pointer-coarse:h-11 pointer-coarse:w-24',
          FOCUS_RING
        )}
      >
        <span className="bg-muted-foreground/25 h-1 w-9 rounded-none" aria-hidden />
        <span className="sr-only">{label}</span>
      </DialogPrimitive.Close>
    </div>
  )
}

export function PageSheetClose({ label }: { label: string }): JSX.Element {
  return (
    <DialogPrimitive.Close
      data-slot="page-sheet-close"
      className={cn(
        'text-muted-foreground hover:bg-hover hover:text-foreground flex size-9 shrink-0 items-center justify-center rounded-control outline-none transition-colors duration-quick ease-out motion-reduce:transition-none pointer-coarse:size-11',
        FOCUS_RING,
      )}
    >
      <X className="size-4" aria-hidden />
      <span className="sr-only">{label}</span>
    </DialogPrimitive.Close>
  )
}
