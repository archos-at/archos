'use client'

import { type FC, type ReactNode, useState } from 'react'
import { AlertTriangle, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyStateDisc } from '@/components/ui/empty-state'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel: string
  cancelLabel: string
  tone?: 'destructive' | 'warning' | 'default'
  icon?: LucideIcon | null
  onConfirm: () => void | Promise<void>
  pending?: boolean
  children?: ReactNode
  confirmTestId?: string
  confirmDisabled?: boolean
}

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'destructive',
  icon,
  onConfirm,
  pending: pendingProp,
  children,
  confirmTestId,
  confirmDisabled = false,
}) => {
  const [internalPending, setInternalPending] = useState(false)
  const pending = pendingProp ?? internalPending

  const confirmVariant = tone === 'default' ? 'default' : 'destructive'
  const Icon = icon === null ? null : (icon ?? (tone === 'default' ? null : AlertTriangle))

  const handleOpenChange = (next: boolean) => {
    if (pending) return // never close mid-flight
    onOpenChange(next)
  }

  const handleConfirm = async () => {
    if (pendingProp === undefined) {
      try {
        setInternalPending(true)
        await onConfirm()
        onOpenChange(false)
      } catch {
        // A throwing `onConfirm` means the action did not land, so the dialog
      } finally {
        setInternalPending(false)
      }
    } else {
      await onConfirm()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-busy={pending || undefined}>
        <DialogHeader>
          <div className="flex items-start gap-3.5">
            {Icon && (
              <EmptyStateDisc
                icon={Icon}
                tone={tone === 'warning' ? 'warning' : 'destructive'}
                size="sm"
                className="mt-0.5"
              />
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              {/* `overflow-wrap:anywhere`: titles routinely quote a file name, and a
                  long one with no spaces otherwise widens the dialog past the viewport. */}
              <DialogTitle className="text-balance text-base leading-snug [overflow-wrap:anywhere]">{title}</DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
              {children && <div className="text-pretty text-sm text-muted-foreground">{children}</div>}
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={pending}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            variant={confirmVariant}
            onClick={() => void handleConfirm()}
            loading={pending}
            disabled={confirmDisabled}
            data-testid={confirmTestId}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
