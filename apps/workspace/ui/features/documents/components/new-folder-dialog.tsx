'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'

export interface NewFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string) => Promise<boolean>
  label?: string
}

export function NewFolderDialog({ open, onOpenChange, onCreate, label }: NewFolderDialogProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const action = label ?? t('folders.newFolder')
  const [name, setName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const commit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || isCreating) return
    setIsCreating(true)
    const ok = await onCreate(trimmed)
    setIsCreating(false)
    if (ok) {
      setName('')
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (isCreating ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{action}</DialogTitle>
        </DialogHeader>
        <InputGroup>
          <InputGroupAddon align="start" className="left-2">
            <Folder aria-hidden />
          </InputGroupAddon>
          <Input
            autoFocus
            value={name}
            disabled={isCreating}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commit()
            }}
            placeholder={t('folders.namePlaceholder')}
            aria-label={t('folders.newFolderName')}
            aria-busy={isCreating}
            className="h-8 rounded-control pl-8 pr-8"
            data-testid="listing-new-folder-input"
          />
          {isCreating && (
            <InputGroupAddon align="end">
              <Spinner size="sm" label={t('folders.creating')} />
            </InputGroupAddon>
          )}
        </InputGroup>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isCreating}>
            {t('rename.cancel')}
          </Button>
          <Button type="button" onClick={() => void commit()} disabled={isCreating || name.trim() === ''}>
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
