'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { ActionMenu } from '@/components/ui/action-menu'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { folderActionEntries } from './folder-action-entries'
import { FolderPickerSheet } from './folder-picker-sheet'
import { sortedFolderDestinations, type PathFolder } from '../lib/folder-path-label'

const TriggerContext = createContext<ReactNode>(null)

export function FolderActionsTrigger(): ReactNode {
  return useContext(TriggerContext)
}

export interface FolderObjectMenuProps {
  asChild?: boolean
  folder: PathFolder
  folders: readonly PathFolder[]
  canAcceptMove?: (targetFolderId: string | null) => boolean
  onOpen: () => void
  onNewInside?: () => void
  onRename: () => void
  onDescribe?: () => void
  onMove?: (parentId: string | null, parentName: string) => void
  onAccess?: () => void
  onDelete: () => void
  readOnly?: boolean
  moveInSheet?: boolean
  children: ReactNode
}

export function FolderObjectMenu({
  folder,
  folders,
  canAcceptMove,
  onOpen,
  onNewInside,
  onRename,
  onDescribe,
  onMove,
  onAccess,
  onDelete,
  readOnly = false,
  moveInSheet = false,
  asChild = false,
  children,
}: FolderObjectMenuProps): ReactNode {
  const t = useTranslations(filesCopy)
  const [moveOpen, setMoveOpen] = useState(false)
  const pickerDestinations = useMemo(
    () =>
      moveOpen ? sortedFolderDestinations(folders).filter(({ folder: dest }) => dest.id !== folder.id) : [],
    [moveOpen, folders, folder.id]
  )
  const entries = useMemo(
    () =>
      folderActionEntries({
        folder,
        labels: {
          open: t('folders.open'),
          newInside: t('folders.newInside'),
          rename: t('folders.rename'),
          move: t('folders.move'),
          delete: t('folders.delete'),
          allFiles: t('folders.allFiles'),
          access: t('folders.access.menu'),
          describe: t('folders.describe'),
          readOnly: t('folders.access.readOnlyMenu'),
        },
        folders,
        canAcceptMove,
        onOpen,
        onNewInside,
        onRename,
        onDescribe,
        onMove,
        onPickMoveTarget: moveInSheet ? () => setMoveOpen(true) : undefined,
        onAccess,
        onDelete,
        readOnly,
      }),
    [
      moveInSheet,
      readOnly,
      folder,
      folders,
      canAcceptMove,
      onOpen,
      onNewInside,
      onRename,
      onDescribe,
      onMove,
      onAccess,
      onDelete,
      t,
    ],
  )

  const trigger = (
    <ActionMenu
      mode="dropdown"
      entries={entries}
      trigger={
        <button
          type="button"
          aria-label={t('folders.actionsFor', { name: folder.name })}
          title={t('folders.actions')}
          className="hover:bg-hover focus-visible:ring-ring flex size-8 shrink-0 items-center justify-center rounded-full transition-opacity duration-snap ease-out focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 pointer-coarse:size-11 pointer-coarse:opacity-100 motion-reduce:transition-none md:opacity-0 md:group-hover:opacity-100 data-[state=open]:opacity-100"
          data-testid={`folder-actions-${folder.id}`}
        >
          <MoreHorizontal className="size-3.5" aria-hidden />
        </button>
      }
    />
  )

  return (
    <TriggerContext.Provider value={trigger}>
      <ActionMenu mode="context" entries={entries} asChild={asChild}>
        {children}
      </ActionMenu>
      {moveInSheet && onMove && (
        <FolderPickerSheet
          open={moveOpen}
          onOpenChange={setMoveOpen}
          title={t('picker.titleOne', { name: folder.name })}
          destinations={pickerDestinations}
          currentFolderId={folder.parentId ?? null}
          canPick={canAcceptMove}
          onPick={(parentId, parentName) => {
            setMoveOpen(false)
            onMove?.(parentId, parentName)
          }}
        />
      )}
    </TriggerContext.Provider>
  )
}
