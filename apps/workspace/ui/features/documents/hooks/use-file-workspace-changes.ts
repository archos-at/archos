'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useShelfLive, type ShelfChange } from '@/features/realtime/use-shelf-live'
import type { LiveShelf } from '@/lib/documents/shelf-live-events'
import type { FileShelf } from '../lib/file-shelf'
import { useDocumentMoves } from './use-document-moves'
import { isInternalDragActive } from './use-document-drag'
import { useShelfUpload } from './use-shelf-upload'
import { useFolderAccess } from './use-folder-access'
import type { FileWorkspaceListing } from './use-file-workspace-listing'

export function useFileWorkspaceChanges({ shelf, state }: { shelf: FileShelf; state: FileWorkspaceListing }) {
  const { collectionName, selectedFolderId, files, setFiles, tree, reloadFiles, reloadQuietly, reloadSummary } = state
  const { folders } = tree
  const upload = shelf.useUpload({
    collectionName,
    folderId: selectedFolderId ?? undefined,
    onComplete: reloadQuietly,
  })
  const { isUploading, error } = upload

  const moves = useDocumentMoves(files, setFiles, folders)
  const { moved: moveRow, dropInFolder: dropRowInFolder, moveMany, isMoving } = moves

  const liveShelf = useMemo<LiveShelf>(
    () => (shelf.projectId ? { kind: 'project', projectId: shelf.projectId } : { kind: 'office_shelf' }),
    [shelf.projectId]
  )
  const { load: loadFolders } = tree
  const onShelfChanged = useCallback(
    (change: ShelfChange) => {
      reloadQuietly()
      if (change.folders) void loadFolders()
    },
    [reloadQuietly, loadFolders]
  )
  const fileDraggingRef = useRef(false)
  const folderMoving = tree.isMoving
  const holdLive = useCallback(
    () => isMoving() || folderMoving() || isInternalDragActive() || fileDraggingRef.current,
    [isMoving, folderMoving]
  )
  useShelfLive(liveShelf, onShelfChanged, { holdWhile: holdLive })
  const moved = useCallback(
    (fileId: string, folderId: string | null) => {
      moveRow(fileId, folderId)
      void reloadSummary()
    },
    [moveRow, reloadSummary]
  )
  const dropInFolder = useCallback(
    async (documentId: string, folderId: string | null) => {
      await dropRowInFolder(documentId, folderId)
      void reloadSummary()
    },
    [dropRowInFolder, reloadSummary]
  )
  const shelfUpload = useShelfUpload({
    shelf,
    upload,
    folders,
    foldersReady: !tree.isFirstLoad && !tree.error,
    foldersSettled: !tree.isFirstLoad,
    selectedFolderId,
    loadFolders: tree.load,
    loadFiles: reloadFiles,
    uploading: isUploading,
  })
  const { handleUpload } = shelfUpload
  const access = useFolderAccess(shelf, folders, tree.rootAccess)
  const writableHere = access.mayWriteAt(selectedFolderId)
  return {
    upload,
    isUploading,
    error,
    moveMany,
    moved,
    dropInFolder,
    shelfUpload,
    handleUpload,
    access,
    writableHere,
    fileDraggingRef,
  }
}

export type FileWorkspaceChanges = ReturnType<typeof useFileWorkspaceChanges>
