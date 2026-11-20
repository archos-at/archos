'use client'

import { useCallback, useState } from 'react'
import type { FolderItem } from '../file-types'
import type { FileShelf, FolderAccessLevel } from '../lib/file-shelf'
import {
  DEFAULT_DOCUMENT_ACTIONS,
  READ_ONLY_DOCUMENT_ACTIONS,
  type DocumentActionKind,
} from '../components/document-actions/action-entries'

export function useFolderAccess(shelf: FileShelf, folders: readonly FolderItem[], treeRootAccess: FolderAccessLevel) {
  const { folderAccess } = shelf
  const rootAccess: FolderAccessLevel = folderAccess ? treeRootAccess : 'write'
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)

  const accessAt = useCallback(
    (folderId: string | null): FolderAccessLevel => {
      if (!folderAccess) return 'write'
      if (folderId === null) return rootAccess
      return folders.find((folder) => folder.id === folderId)?.access === 'read' ? 'read' : 'write'
    },
    [folderAccess, folders, rootAccess]
  )
  const mayWriteAt = useCallback((folderId: string | null) => accessAt(folderId) === 'write', [accessAt])
  const documentActionsAt = useCallback(
    (folderId: string | null): readonly DocumentActionKind[] =>
      accessAt(folderId) === 'read' ? READ_ONLY_DOCUMENT_ACTIONS : DEFAULT_DOCUMENT_ACTIONS,
    [accessAt]
  )

  const folderNav = folderAccess
    ? {
        onEditFolderAccess: folderAccess.canManage ? setEditingFolderId : undefined,
        rootAccess,
      }
    : {}

  return { mayWriteAt, documentActionsAt, folderNav, editingFolderId, setEditingFolderId }
}
