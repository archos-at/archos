'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { CheckSquare, FolderPlus } from 'lucide-react'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { NewFolderDialog } from './new-folder-dialog'

export function usePhoneRootTools({
  active,
  onStartSelection,
  onCreateFolder,
}: {
  active: boolean
  onStartSelection?: () => void
  onCreateFolder?: (name: string) => Promise<boolean>
}): { entries: ActionMenuEntry[]; dialog: JSX.Element | null } {
  const t = useTranslations(filesCopy)
  const [open, setOpen] = useState(false)
  if (!active) return { entries: [], dialog: null }
  const entries: ActionMenuEntry[] = [
    ...(onStartSelection
      ? [{ type: 'item' as const, id: 'select', label: t('selection.start'), icon: CheckSquare, onSelect: onStartSelection, testId: 'selection-start' }]
      : []),
    ...(onCreateFolder
      ? [{ type: 'item' as const, id: 'new-folder', label: t('folders.newFolder'), icon: FolderPlus, onSelect: () => setOpen(true), testId: 'files-new-folder' }]
      : []),
  ]
  const dialog = onCreateFolder ? <NewFolderDialog open={open} onOpenChange={setOpen} onCreate={onCreateFolder} /> : null
  return { entries, dialog }
}
