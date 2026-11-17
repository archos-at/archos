'use client'

import { useId, useState, type FC, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyStateDisc } from '@/components/ui/empty-state'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface TypeToConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmName: string
  confirmLabel: string
  typeToConfirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
  pending?: boolean
}

export const TypeToConfirmDialog: FC<TypeToConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmName,
  confirmLabel,
  typeToConfirmLabel = 'Type {name} to confirm:',
  cancelLabel = 'Cancel',
  onConfirm,
  pending = false,
}) => {
  const [value, setValue] = useState('')
  const inputId = useId()
  const matches = value === confirmName
  const [labelBefore, labelAfter] = typeToConfirmLabel.split('{name}')

  const handleOpenChange = (next: boolean) => {
    if (pending) return
    if (!next) setValue('')
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base leading-snug">
            <EmptyStateDisc icon={AlertTriangle} tone="destructive" size="sm" />
            <span>{title}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="text-sm">{description}</div>
          <Field>
            <FieldLabel htmlFor={inputId} className="font-normal">
              {labelBefore}
              <span className="font-medium">{confirmName}</span>
              {labelAfter}
            </FieldLabel>
            <Input
              id={inputId}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={confirmName}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="done"
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !matches || pending) return
                event.preventDefault()
                void onConfirm()
              }}
              disabled={pending}
            />
          </Field>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={pending}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={!matches}
            loading={pending}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
