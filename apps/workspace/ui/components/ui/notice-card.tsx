'use client'

/**
 * A calm, non-modal card in the corner of the window: a short notice the reader can read, act on
 * or close, while the page under it stays usable. The weekly "Neu diese Woche" summary is its
 * first user (`features/whats-new`).
 *
 * Domain-free, like {@link TourCard}, and the same material: the popover surface, the square
 * surface radius, a hairline and a shadow. Bottom-right on a wide screen, below the header on a phone.
 *
 * Built on Radix Dialog with `modal={false}`: no scrim, nothing outside made inert, clicking the
 * page does not close it (a notice is closed on purpose, not by a stray click), and Escape closes
 * it from anywhere, through Radix's layer stack, so a dialog opened above it closes first.
 * Focus moves to the card's first action when it opens, so a keyboard reader lands on it and a
 * screen reader announces it, and goes back to where it was when it closes.
 */

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { JSX } from 'react'

/** How a notice was closed: a button that closes it, or Escape. */
export type NoticeCloseReason = 'close_button' | 'escape'

export interface NoticeCardProps {
  open: boolean
  title: string
  /** A small label above the title, such as the week it speaks for. */
  eyebrow?: string
  children: React.ReactNode
  /** The card's actions; the first focusable one receives focus when the card opens. */
  actions: React.ReactNode
  closeLabel: string
  /** The × in the corner. Off when the actions already hold a button that closes. */
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
            'bg-popover text-popover-foreground rounded-surface fixed z-50 border p-5 shadow-lg',
            // The bottom-right corner on a wide screen. On a phone the bottom is the tab bar's and
            // the thumb's, so the card hangs below the header, full width less the gutters.
            'md:right-4 md:bottom-4 md:w-[min(24rem,calc(100vw-2rem))]',
            'max-md:inset-x-4 max-md:top-[calc(env(safe-area-inset-top)+4rem)]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2 duration-base ease-entrance motion-reduce:animate-none',
            className
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {eyebrow && (
                <p className="text-muted-foreground text-[10.5px] font-medium tracking-wider uppercase tabular-nums">
                  {eyebrow}
                </p>
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
                className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/60 touch-target rounded-control duration-quick -m-1.5 flex size-7 shrink-0 items-center justify-center transition-colors ease-out focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
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
