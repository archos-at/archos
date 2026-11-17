'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'next/navigation'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { createDocumentByNameClient } from '@/lib/documents/by-name-client'
import { shelfSummaryUrl, type LevelPageRequest } from '@/lib/documents/level-client'
import type { FileItem, FolderItem } from '../file-types'
import type { DocumentWireRow } from '../lib/file-item'
import type { FileShelf } from '../lib/file-shelf'
import { LEVEL_SEARCH_DEBOUNCE_MS, levelSortOf, readFamiliesOf, readsWholeShelf } from '../lib/level-view'
import { NO_FILE_FILTERS, type FileFilters } from '../lib/file-filters'
import { DEFAULT_FILE_SORT, type FileSort } from '../lib/file-sort'
import { COMPARE_PARAM } from '../lib/revision-compare-link'
import { mergeById } from '../lib/merge-by-id'
import { useFileSearch } from './use-file-search'
import { useFileListing } from './use-file-listing'
import { useShelfSummary } from './use-shelf-summary'
import { useFolderTree } from './use-folder-tree'
import { useLevelListing } from './use-level-listing'
import { useLinkedDocuments } from './use-linked-documents'
import { useFolderParam } from './use-folder-param'
import { useViewPreference } from './use-view-preference'

export function useFileWorkspaceListing({
  shelf,
  initialFolders,
  initialFiles,
  initialNextCursor,
  initialFolderId,
}: {
  shelf: FileShelf
  initialFolders?: readonly FolderItem[]
  initialFiles?: readonly DocumentWireRow[]
  initialNextCursor: string | null
  initialFolderId: string | null
}) {
  const { canCollaborate } = shelf
  const searchParams = useSearchParams()

  const [chosenView, selectView] = useViewPreference()
  const [selectedFolderId, selectFolder] = useFolderParam()
  const [filters, setFilters] = useState<FileFilters>(NO_FILE_FILTERS)
  const [sort, setSort] = useState<FileSort>(DEFAULT_FILE_SORT)
  const search = useFileSearch(shelf.endpoints)
  const serverQuery = useDebouncedValue(search.query.trim(), LEVEL_SEARCH_DEBOUNCE_MS)

  const wholeShelf = readsWholeShelf(filters, sort, canCollaborate)
  const [detailsWanted, setDetailsWanted] = useState(false)
  const pagedView = !wholeShelf

  const listing = useFileListing({
    endpoints: shelf.endpoints,
    agentAuthoredOnly: filters.agentAuthoredOnly,
    includeArchived: filters.includeArchived,
    enabled: wholeShelf || detailsWanted,
  })
  const shelfSummary = useShelfSummary({
    url: shelfSummaryUrl(shelf.endpoints, {
      agentAuthoredOnly: filters.agentAuthoredOnly,
      includeArchived: filters.includeArchived,
    }),
  })

  const reloadFilesRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const reloadFiles = useCallback(() => reloadFilesRef.current(), [])
  const documentCountRef = useRef<(folderId: string) => number>(() => 0)
  const documentCountIn = useCallback((folderId: string) => documentCountRef.current(folderId), [])

  const tree = useFolderTree({
    foldersUrl: shelf.endpoints.folders,
    initialFolders,
    initialRootAccess: shelf.folderAccess?.initialRootAccess,
    files: listing.files,
    documentCountIn,
    selectedFolderId,
    onSelectFolder: selectFolder,
    reloadFiles,
    binHref: shelf.bin?.href,
  })

  const levelSort = levelSortOf(sort)
  const searchingServer = serverQuery !== ''
  const levelFolderId = searchingServer || tree.error ? undefined : selectedFolderId
  const levelRequest = useMemo((): Omit<LevelPageRequest, 'limit'> | null => {
    if (!pagedView || levelSort === null) return null
    return {
      list: shelf.endpoints.list,
      listParams: shelf.endpoints.listParams,
      folderId: levelFolderId,
      sort: levelSort,
      dir: sort.direction,
      q: searchingServer ? serverQuery : undefined,
      states: readFamiliesOf(filters.statuses),
      agentAuthoredOnly: filters.agentAuthoredOnly,
      includeArchived: filters.includeArchived,
    }
  }, [
    pagedView,
    levelSort,
    sort.direction,
    shelf.endpoints.list,
    shelf.endpoints.listParams,
    levelFolderId,
    searchingServer,
    serverQuery,
    filters.statuses,
    filters.agentAuthoredOnly,
    filters.includeArchived,
  ])
  const [levelSeed] = useState(() =>
    initialFiles !== undefined && selectedFolderId === initialFolderId
      ? { rows: initialFiles, nextCursor: initialNextCursor }
      : undefined
  )
  const level = useLevelListing({
    request: levelRequest,
    resetKey: searchingServer ? 'search' : levelFolderId === undefined ? 'shelf' : `folder:${levelFolderId ?? 'root'}`,
    initialPage: levelSeed,
  })

  const paneFiles = pagedView ? level.files : listing.files
  const collectionName = shelf.collectionName ?? level.collectionName ?? listing.collectionName

  const byNameClient = useMemo(() => createDocumentByNameClient(), [])
  const resolveOfficeShelfByName = useCallback((name: string) => byNameClient.officeShelf([name]), [byNameClient])
  const loadedFiles = useMemo(
    () => (listing.files.length === 0 ? level.files : mergeById(level.files, listing.files)),
    [level.files, listing.files]
  )
  const linked = useLinkedDocuments({
    known: loadedFiles,
    ids: [searchParams?.get('doc'), searchParams?.get(COMPARE_PARAM)],
    byName:
      shelf.showModels && shelf.projectId === null
        ? { name: searchParams?.get('model')?.trim() || null, resolve: resolveOfficeShelfByName }
        : undefined,
  })
  const files = useMemo(
    () => (linked.files.length === 0 ? loadedFiles : [...loadedFiles, ...linked.files]),
    [loadedFiles, linked.files]
  )

  const { setFiles: setLevelFiles } = level
  const { setFiles: setListingFiles } = listing
  const { setFiles: setLinkedFiles } = linked
  const setFiles = useCallback<Dispatch<SetStateAction<FileItem[]>>>(
    (action) => {
      setLevelFiles(action)
      setListingFiles(action)
      setLinkedFiles(action)
    },
    [setLevelFiles, setListingFiles, setLinkedFiles]
  )

  const { reload: reloadLevel } = level
  const { reload: reloadSummary } = shelfSummary
  const { load: loadListing, reloadQuietly: reloadListingQuietly } = listing
  const reloadAll = useCallback(async () => {
    await Promise.all([reloadLevel(true), reloadSummary(), loadListing(true)])
  }, [reloadLevel, reloadSummary, loadListing])
  const reloadQuietly = useCallback(() => {
    void reloadLevel(true)
    void reloadSummary()
    reloadListingQuietly()
  }, [reloadLevel, reloadSummary, reloadListingQuietly])
  useEffect(() => {
    reloadFilesRef.current = reloadAll
  }, [reloadAll])
  return {
    chosenView,
    selectView,
    selectedFolderId,
    selectFolder,
    filters,
    setFilters,
    sort,
    setSort,
    search,
    wholeShelf,
    detailsWanted,
    setDetailsWanted,
    pagedView,
    listing,
    shelfSummary,
    tree,
    reloadFiles,
    reloadQuietly,
    reloadSummary,
    reloadAll,
    documentCountRef,
    level,
    paneFiles,
    collectionName,
    linked,
    files,
    setFiles,
  }
}

export type FileWorkspaceListing = ReturnType<typeof useFileWorkspaceListing>
