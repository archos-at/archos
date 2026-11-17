'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { useRouter } from 'next/navigation'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const EXIT_FALLBACK_MS = 220

export interface RouteDialogProps {
  title: string
  description?: React.ReactNode
  closeLabel: string
  standalone?: boolean
  fallbackHref?: string
  bodyClassName?: string
  testId?: string
  children: React.ReactNode
}

export function RouteDialog({
  title,
  description,
  closeLabel,
  standalone = false,
  fallbackHref = '/app/projects',
  bodyClassName,
  testId,
  children,
}: RouteDialogProps): JSX.Element {
  const router = useRouter()
  const [open, setOpen] = React.useState(true)
  const left = React.useRef(false)

  const leave = React.useCallback(() => {
    if (left.current) return
    left.current = true
    if (standalone || (typeof window !== 'undefined' && window.history.length <= 1)) router.push(fallbackHref)
    else router.back()
  }, [standalone, fallbackHref, router])

  React.useEffect(() => {
    if (open) return
    const timer = setTimeout(leave, EXIT_FALLBACK_MS)
    return () => clearTimeout(timer)
  }, [open, leave])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
      <DialogContent
        closeLabel={closeLabel}
        data-testid={testId}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement | null)?.focus()
        }}
        onAnimationEnd={(event) => {
          if (!open && event.target === event.currentTarget) leave()
        }}
        className="flex max-h-[min(54rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 outline-none sm:max-w-2xl"
      >
        <DialogHeader className="border-b px-5 pt-5 pb-4 pr-14 text-left sm:px-6">
          <DialogTitle className="text-lg font-medium">{title}</DialogTitle>
          {description ? (
            <DialogDescription asChild>
              <div>{description}</div>
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        {/* `p-0` above hands the dialog's padding, and with it the bottom
            safe area, to this body: on a phone the sheet's bottom edge is the
            screen's, so the last line clears the home indicator. */}
        <div
          className={cn(
            'scroll-fade-bottom min-h-0 flex-1 overflow-y-auto px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6',
            bodyClassName
          )}
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}
