'use client'

/**
 * A phone's level of Dateien: „Auswählen“ and „Ordner anlegen“ as the first
 * entries of the header's ⋯ (iOS Files' order), not as a row of two presses
 * above the brief, at the root and inside a folder alike (the header names the
 * folder and its ← goes up). The hook gives the entries and the dialog
 * „Ordner anlegen“ opens, in the level the reader stands in.
 */

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
  /** A phone, at any level, with the folder tree in. */
  active: boolean
  /** „Auswählen“, where there is something to pick; absent otherwise. */
  onStartSelection?: () => void
  /** „Ordner anlegen“, where the reader may create one here; absent otherwise. */
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
