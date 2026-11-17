'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { SectionLabel } from '@/components/ui/section-label'
import { cn } from '@/lib/utils'
import type { JSX } from 'react'

export type NoticeCloseReason = 'close_button' | 'escape'

export interface NoticeCardProps {
  open: boolean
  title: string
  eyebrow?: string
  children: React.ReactNode
  actions: React.ReactNode
  closeLabel: string
  closeButton?: boolean
  onClose: (reason: NoticeCloseReason) => void
  className?: string
}

export function NoticeCard({
  open,
  title,
  eyebrow,
  children,
  actions,
  closeLabel,
  closeButton = true,
  onClose,
  className,
}: NoticeCardProps): JSX.Element {
  const actionsRef = React.useRef<HTMLDivElement>(null)
  const previousFocusRef = React.useRef<HTMLElement | null>(null)

  return (
    <DialogPrimitive.Root
      open={open}
      modal={false}
      onOpenChange={(next) => !next && onClose('close_button')}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          data-slot="notice-card"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            previousFocusRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null
            actionsRef.current
              ?.querySelector<HTMLElement>('a, button')
              ?.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const previous = previousFocusRef.current
            if (previous?.isConnected) previous.focus({ preventScroll: true })
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            onClose('escape')
          }}
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            'bg-popover text-popover-foreground rounded-surface fixed z-50 p-5 shadow-lg',
            'md:right-4 md:bottom-4 md:w-[min(24rem,calc(100vw-2rem))]',
            'max-md:inset-x-4 max-md:top-[calc(env(safe-area-inset-top)+4rem)]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2 duration-base ease-entrance motion-reduce:animate-none',
            className
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {eyebrow && (
                <SectionLabel as="p" className="tabular-nums">
                  {eyebrow}
                </SectionLabel>
              )}
              <DialogPrimitive.Title className="mt-1 text-sm font-medium">
                {title}
              </DialogPrimitive.Title>
            </div>
            {closeButton && (
              <button
                type="button"
                onClick={() => onClose('close_button')}
                aria-label={closeLabel}
                className="text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-ring/60 touch-target rounded-control duration-quick -m-1.5 flex size-7 shrink-0 items-center justify-center transition-colors ease-out focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
          <div className="text-muted-foreground mt-2 text-sm leading-relaxed">{children}</div>
          <div ref={actionsRef} className="mt-4 flex flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
