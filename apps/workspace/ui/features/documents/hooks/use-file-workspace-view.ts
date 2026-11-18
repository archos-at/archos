'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { tagLabel } from '@/lib/documents/tag-vocabulary'
import type { FolderItem } from '../file-types'
import type { FileShelf } from '../lib/file-shelf'
import {
  buildFolderBrief,
  buildFolderBriefFromSummary,
  talliesFromSummary,
  type FolderBrief as FolderBriefData,
} from '../lib/folder-knowledge'
import { applyFileFilters, tagOptions as tagOptionsOf } from '../lib/file-filters'
import { withoutOlderRevisions } from '../lib/revision-chain'
import { fileViewFor } from './use-view-preference'
import { useFilterEmptyNotice } from './use-filter-empty-notice'
import { useFolderBriefSurface } from './use-folder-brief-surface'
import type { FileWorkspaceListing } from './use-file-workspace-listing'
import type { PreviewHandlers } from './use-preview-channel'

const NO_FOLDERS: readonly FolderItem[] = []

export function useFileWorkspaceView({
  shelf,
  state,
  writableHere,
  handlers,
}: {
  shelf: FileShelf
  state: FileWorkspaceListing
  writableHere: boolean
  handlers: PreviewHandlers
}) {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const { canManage, canCollaborate } = shelf
  const {
    chosenView,
    paneFiles,
    files,
    filters,
    setFilters,
    search,
    wholeShelf,
    detailsWanted,
    setDetailsWanted,
    pagedView,
    listing,
    shelfSummary,
    tree,
    selectedFolderId,
    selectFolder,
    level,
    documentCountRef,
    reloadSummary,
  } = state
  const { folders } = tree
  const filteredFiles = useMemo(
    () => applyFileFilters(paneFiles, filters, { canCollaborate, currentUserId: shelf.currentUserId }),
    [paneFiles, filters, canCollaborate, shelf.currentUserId]
  )
  const listedFiles = useMemo(
    () => withoutOlderRevisions(filteredFiles, filters.showOlderRevisions),
    [filteredFiles, filters.showOlderRevisions]
  )
  const levelFiles = useMemo(
    () =>
      tree.error
        ? listedFiles
        : listedFiles.filter((file) => (file.folderId ?? null) === selectedFolderId),
    [listedFiles, selectedFolderId, tree.error]
  )
  const view = fileViewFor(chosenView, levelFiles.length) // the reader's choice, else the list above fifty documents
  const tagOptions = useMemo(
    () => tagOptionsOf(paneFiles, locale, (tag) => tagLabel(tag, t)),
    [paneFiles, locale, t]
  )

  const summaryTallies = useMemo(
    () => (shelfSummary.summary ? talliesFromSummary(shelfSummary.summary, folders) : null),
    [shelfSummary.summary, folders]
  )
  const folderStats = useMemo(() => {
    if (!pagedView || !summaryTallies) return undefined
    const counts = new Map<string, number>()
    for (const [id, tally] of summaryTallies.direct) {
      if (id !== null) counts.set(id, tally.total)
    }
    for (const folder of folders) {
      if (folder.parentId !== null) counts.set(folder.parentId, (counts.get(folder.parentId) ?? 0) + 1)
    }
    return { counts, tallies: summaryTallies.subtree }
  }, [pagedView, summaryTallies, folders])
  useEffect(() => {
    documentCountRef.current = (folderId) =>
      summaryTallies
        ? (summaryTallies.direct.get(folderId)?.total ?? 0)
        : files.filter((file) => file.folderId === folderId).length
  })

  const corpusReady = (wholeShelf || detailsWanted) && listing.complete && !listing.isLoading && !listing.error
  const briefFolders = tree.error ? NO_FOLDERS : folders
  const briefData = useMemo((): FolderBriefData | null => {
    if (corpusReady) return buildFolderBrief(listing.files, briefFolders, selectedFolderId)
    if (shelfSummary.summary) return buildFolderBriefFromSummary(shelfSummary.summary, briefFolders, selectedFolderId)
    if (shelfSummary.error) return buildFolderBrief(paneFiles, briefFolders, selectedFolderId)
    return null
  }, [corpusReady, listing.files, shelfSummary.summary, shelfSummary.error, paneFiles, briefFolders, selectedFolderId])
  const requestDetails = useCallback(() => setDetailsWanted(true), [setDetailsWanted])
  const briefSurface = useFolderBriefSurface({
    shelf,
    brief: briefData,
    folders: briefFolders,
    selectedFolderId,
    onOpenFolder: selectFolder,
    onReingested: handlers.onReingested,
    onReadAgainDone: reloadSummary,
    onRequestDetails: requestDetails,
    detailsLoading: (wholeShelf || detailsWanted) && !corpusReady,
    mayReadAgain: canManage && writableHere,
  })

  const levelKey = tree.error ? null : selectedFolderId
  const levelOccupied =
    pagedView && summaryTallies
      ? tree.error
        ? summaryTallies.total > 0
        : (summaryTallies.direct.get(levelKey)?.total ?? 0) > 0
      : tree.error
        ? paneFiles.length > 0
        : paneFiles.some((file) => (file.folderId ?? null) === selectedFolderId)
  const filterEmptyNotice = useFilterEmptyNotice({
    filters,
    setFilters,
    canCollaborate,
    search,
    levelFiles,
    levelOccupied,
  })

  const shelfCount = pagedView
    ? (summaryTallies?.total ?? null)
    : listing.isLoading || listing.error || !listing.complete
      ? null
      : listing.files.length
  const listingError = pagedView ? level.error : listing.error
  const retryListing = pagedView ? () => void level.reload(false) : () => void listing.load()
  return {
    view,
    tagOptions,
    filteredFiles,
    levelFiles,
    summaryTallies,
    folderStats,
    briefSurface,
    filterEmptyNotice,
    shelfCount,
    listingError,
    retryListing,
  }
}
