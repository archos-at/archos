'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ProposalListQuery } from '@/lib/proposals/types'
import type { FileShelf } from '../lib/file-shelf'
import { useFilingSuggestions } from './use-filing-suggestions'
import { useSettleTrackedUploads } from './use-settle-tracked-uploads'
import type { FileWorkspaceChanges } from './use-file-workspace-changes'
import type { FileWorkspaceListing } from './use-file-workspace-listing'

export function useFileWorkspaceUploads({
  shelf,
  state,
  changes,
}: {
  shelf: FileShelf
  state: FileWorkspaceListing
  changes: FileWorkspaceChanges
}) {
  const { upload, isUploading } = changes
  const { collectionName, paneFiles, files, tree, reloadQuietly, reloadAll } = state
  const { folders } = tree
  const wasUploading = useRef(false)
  useEffect(() => {
    if (wasUploading.current && !isUploading) reloadQuietly()
    wasUploading.current = isUploading
  }, [isUploading, reloadQuietly])

  const activeUploads = useMemo(
    () => upload.trackedFiles.filter((f) => f.collectionName === collectionName && f.file != null),
    [upload.trackedFiles, collectionName]
  )
  useSettleTrackedUploads(paneFiles, activeUploads)

  const filingQuery = useMemo<ProposalListQuery>(
    () => (shelf.projectId ? { projectId: shelf.projectId } : { shelf: 'office_shelf' }),
    [shelf.projectId]
  )
  const filing = useFilingSuggestions({ query: filingQuery, refreshKey: files.length, watching: activeUploads.length > 0 })
  const { reload: reloadFiling } = filing
  const onFilingSettled = useCallback(() => {
    void reloadAll()
    reloadFiling()
  }, [reloadAll, reloadFiling])
  const folderPathOf = useMemo(() => {
    const folderOf = new Map(files.map((file) => [file.id, file.folderId ?? null]))
    const pathOf = new Map(folders.map((folder) => [folder.id, folder.path]))
    return (documentId: string): string | undefined => {
      const folderId = folderOf.get(documentId)
      if (folderId === undefined) return undefined
      return folderId === null ? '' : pathOf.get(folderId)
    }
  }, [files, folders])
  return {
    activeUploads,
    filing,
    onFilingSettled,
    folderPathOf,
  }
}
