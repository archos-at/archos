'use client'

import type { JSX } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { FolderBinPanel } from './folder-bin-panel'

export function FolderBinDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(80dvh,44rem)] overflow-y-auto sm:max-w-3xl" data-testid="folder-bin-dialog">
        <DialogHeader>
          <DialogTitle>{t('bin.title')}</DialogTitle>
          <DialogDescription>{t('bin.dialogDescription')}</DialogDescription>
        </DialogHeader>
        {open && <FolderBinPanel projectId={projectId} inDialog />}
      </DialogContent>
    </Dialog>
  )
}
