'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { FileShelf } from '../lib/file-shelf'
import { useWindowDragGuard } from '../components/file-drop-overlay'
import { useFileDragDrop, type DropInfo } from './use-file-drag-drop'
import { useFolderDropTarget, type FileDropAim } from './use-document-drag'
import type { FileWorkspaceChanges } from './use-file-workspace-changes'
import type { FileWorkspaceListing } from './use-file-workspace-listing'

export function useFileWorkspaceDrop({
  shelf,
  state,
  changes,
}: {
  shelf: FileShelf
  state: FileWorkspaceListing
  changes: FileWorkspaceChanges
}) {
  const t = useTranslations(filesCopy)
  const { canManage } = shelf
  const { selectedFolderId, search, tree } = state
  const { folders } = tree
  const { handleUpload, dropInFolder, fileDraggingRef, writableHere } = changes
  const onDroppedHere = useCallback(
    (dropped: File[], info: DropInfo) => handleUpload(dropped, { info }),
    [handleUpload]
  )
  const { isDragging, isUnsupportedDrag, refusal: dropRefusal, dragHandlers } = useFileDragDrop({
    onDrop: onDroppedHere,
    disabled: !canManage,
    refusal: writableHere ? null : t('workspace.dropRefusedHere'),
    acceptZip: true,
  })
  useEffect(() => {
    fileDraggingRef.current = isDragging
  }, [isDragging, fileDraggingRef])
  const [fileAim, setFileAim] = useState<FileDropAim | null>(null)
  useEffect(() => {
    if (!isDragging) setFileAim(null)
  }, [isDragging])
  const dropFilesInFolder = useCallback(
    (dropped: File[], info: DropInfo, folderId: string | null) => handleUpload(dropped, { folderId, info }),
    [handleUpload]
  )
  const folderNameOf = (folderId: string | null): string =>
    folderId === null ? t('folders.allFiles') : (folders.find((folder) => folder.id === folderId)?.name ?? '')
  const dropTargetLabel = fileAim
    ? t('workspace.dropInto', { name: folderNameOf(fileAim.folderId) })
    : selectedFolderId !== null && folderNameOf(selectedFolderId)
      ? t('workspace.dropInto', { name: folderNameOf(selectedFolderId) })
      : shelf.messages.dropToUpload
  useWindowDragGuard()

  const levelDrop = useFolderDropTarget({
    folderId: selectedFolderId,
    onDropDocument: (documentId, folderId) => void dropInFolder(documentId, folderId),
    onDropFolder: (folderId, parentId) => void tree.move(folderId, parentId),
    disabled: !canManage || search.query.trim() !== '' || search.semantic.active,
    refusal: writableHere ? null : t('workspace.dropRefusedHere'),
    onlyFromElsewhere: true,
  })
  const surfaceDragHandlers = {
    onDragEnter: dragHandlers.onDragEnter,
    onDragOver: (event: React.DragEvent) => {
      levelDrop.dropProps.onDragOver(event)
      dragHandlers.onDragOver(event)
    },
    onDragLeave: (event: React.DragEvent) => {
      levelDrop.dropProps.onDragLeave(event)
      dragHandlers.onDragLeave(event)
    },
    onDrop: (event: React.DragEvent) => {
      levelDrop.dropProps.onDrop(event)
      dragHandlers.onDrop(event)
    },
  }
  return {
    isDragging,
    isUnsupportedDrag,
    dropRefusal,
    surfaceDragHandlers,
    dropTargetLabel,
    fileAim,
    setFileAim,
    dropFilesInFolder,
  }
}
