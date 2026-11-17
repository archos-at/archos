'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { AlertCircle, Archive, Boxes, FileText, RotateCcw } from 'lucide-react'
import { sourceBase } from '@/lib/ui/source-tint'
import { cn } from '@/lib/utils'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { createDocumentByNameClient } from '@/lib/documents/by-name-client'
import { documentDisplayName } from '@/lib/documents/display-name'
import { shelfSummaryUrl, type LevelPageRequest } from '@/lib/documents/level-client'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import type { LiveShelf } from '@/lib/documents/shelf-live-events'
import { offeredForRetry } from '@/lib/documents/retry-policy'
import { tagLabel } from '@/lib/documents/tag-vocabulary'
import { inferDocumentKind } from '../document-kind'
import type { FileItem, FolderItem } from '../file-types'
import { useDocParamSync, usePreviewChannel, type PreviewHandlers } from '../hooks/use-preview-channel'
import { useDocumentMoves } from '../hooks/use-document-moves'
import { useDocumentSelection } from '../hooks/use-document-selection'
import { usePhoneLayout } from '../hooks/use-phone-layout'
import { UploadFab } from './upload-fab'
import { useFileDragDrop, type DropInfo } from '../hooks/use-file-drag-drop'
import { isInternalDragActive, useFolderDropTarget, type FileDropAim } from '../hooks/use-document-drag'
import { useFileListing } from '../hooks/use-file-listing'
import { useFileSearch } from '../hooks/use-file-search'
import { useFilterEmptyNotice } from '../hooks/use-filter-empty-notice'
import { useFolderParam } from '../hooks/use-folder-param'
import { useRootSortParam } from '../hooks/use-root-sort-param'
import { useFolderTree } from '../hooks/use-folder-tree'
import { useIngestionCompleteToast } from '../hooks/use-ingestion-complete-toast'
import { useLevelListing } from '../hooks/use-level-listing'
import { useLinkedDocuments } from '../hooks/use-linked-documents'
import { useModelStage } from '../hooks/use-model-stage'
import { useSettleTrackedUploads } from '../hooks/use-settle-tracked-uploads'
import { useShelfLive, type ShelfChange } from '@/features/realtime/use-shelf-live'
import { useShelfSummary } from '../hooks/use-shelf-summary'
import { useShelfUpload } from '../hooks/use-shelf-upload'
import { fileViewFor, useViewPreference } from '../hooks/use-view-preference'
import { useBriefCollapsed } from '../hooks/use-brief-collapsed'
import { useDocumentFindings } from '../hooks/use-document-findings'
import { useBulkReingest } from '../hooks/use-bulk-reingest'
import { useCompareParam } from '../hooks/use-compare-param'
import { useMissingDocuments } from '../hooks/use-missing-documents'
import { COMPARE_PARAM } from '../lib/revision-compare-link'
import {
  buildFolderBrief,
  buildFolderBriefFromSummary,
  selectInBrief,
  talliesFromSummary,
  type BriefSelection,
  type FolderBrief as FolderBriefData,
} from '../lib/folder-knowledge'
import type { DocumentWireRow } from '../lib/file-item'
import { LEVEL_SEARCH_DEBOUNCE_MS, levelSortOf, readFamiliesOf, readsWholeShelf } from '../lib/level-view'
import {
  NO_FILE_FILTERS,
  applyFileFilters,
  tagOptions as tagOptionsOf,
  type FileFilters,
} from '../lib/file-filters'
import type { FileShelf, FolderAccessLevel } from '../lib/file-shelf'
import { DEFAULT_FILE_SORT, type FileSort } from '../lib/file-sort'
import { DocumentActionsTrigger, DocumentObjectMenu, useMoveInSheet } from './document-actions'
import {
  DEFAULT_DOCUMENT_ACTIONS,
  READ_ONLY_DOCUMENT_ACTIONS,
  type DocumentActionKind,
} from './document-actions/action-entries'
import { FileBrowserPane } from './file-browser-pane'
import { InboundMailWaitingLine } from './inbound-mail-waiting-line'
import { FileDropOverlay, useWindowDragGuard } from './file-drop-overlay'
import { FileFilterMenu } from './file-filter-menu'
import { FilePreviewDialog } from './file-preview-dialog'
import { FolderBrief } from './folder-brief'
import { FolderPickerSheet } from './folder-picker-sheet'
import { RootSortDialog } from './root-sort/root-sort-dialog'
import type { RootSortShelf } from '@/lib/filing/root-sort-types'
import { SelectionBar } from './selection-bar'
import { withoutOlderRevisions } from '../lib/revision-chain'
import { sortedFolderDestinations } from '../lib/folder-path-label'
import { FilesHeaderControls } from './files-header-controls'
import { usePhoneRootTools } from './phone-root-tools'
import { FolderAccessDialog } from './folder-access-dialog'
import { FolderDescriptionDialog } from './folder-description-dialog'
import { FilingSuggestionsProvider } from './filing-suggestion'
import { useFilingSuggestions } from '../hooks/use-filing-suggestions'
import type { ProposalListQuery } from '@/lib/proposals/types'
import { FolderUploadDialog } from './folder-upload-dialog'
import { ProjectUppyUpload } from './project-uppy-upload'
import { UploadTray } from './upload-tray'
import { UPLOAD_TRAY_SHEET } from './upload-tray-sheet'
import { UploadProblemAlert } from './upload-anyway'

const ModelStage = dynamic(
  () => import('@/features/bim/components/model-stage').then((module) => module.ModelStage),
  { ssr: false }
)

export interface FileWorkspaceProps {
  shelf: FileShelf
  renderHeader: (controls: ReactNode, state: { count: number | null }) => ReactNode
  moreEntries?: readonly ActionMenuEntry[]
  onOpenSearch?: (text: string) => void
  initialFolders?: readonly FolderItem[]
  initialFiles?: readonly DocumentWireRow[]
  initialNextCursor?: string | null
  initialFolderId?: string | null
}

const renderDocumentActions = (): ReactNode => <DocumentActionsTrigger />

const NO_FILES: readonly FileItem[] = []
const NO_FOLDERS: readonly FolderItem[] = []

function mergeById(first: readonly FileItem[], second: readonly FileItem[]): FileItem[] {
  const held = new Set(first.map((file) => file.id))
  return [...first, ...second.filter((file) => !held.has(file.id))]
}

export function FileWorkspace({
  shelf,
  renderHeader,
  moreEntries,
  onOpenSearch,
  initialFolders,
  initialFiles,
  initialNextCursor = null,
  initialFolderId = null,
}: FileWorkspaceProps) {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const { canManage, canCollaborate } = shelf
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
  const { folders } = tree

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

  const patchFile = useCallback(
    (fileId: string, patch: Partial<FileItem>) =>
      setFiles((prev) => (prev.some((f) => f.id === fileId) ? prev.map((f) => (f.id === fileId ? { ...f, ...patch } : f)) : prev)),
    [setFiles]
  )

  const filesRef = useRef(files)
  const openRef = useRef<(file: FileItem) => void>(() => undefined)
  const handlers = useMemo<PreviewHandlers>(
    () => ({
      onOpenDocument: (id) => {
        const file = filesRef.current.find((candidate) => candidate.id === id)
        if (file) openRef.current(file)
      },
      onRevisionChanged: (id, revision) => patchFile(id, { revision }),
      onReingested: (id, status) => patchFile(id, { status, errorMessage: null }),
      onTagsUpdated: (id, tags, topics) => patchFile(id, topics === undefined ? { tags } : { tags, topics }),
      onLifecycleChanged: (id, summary: { versionState: DocumentVersionState; versionCount: number }) =>
        patchFile(id, summary),
      onMarksChanged: (id, marks) => patchFile(id, { marks }),
      onDeleted: (id) => {
        setFiles((prev) => prev.filter((f) => f.id !== id))
        void reloadSummary()
      },
      onRenamed: (id, displayName) => patchFile(id, { displayName }),
    }),
    [patchFile, setFiles, reloadSummary]
  )

  const channel = usePreviewChannel(shelf, files, handlers)
  const compareElement = useCompareParam(files, linked.settled || (!pagedView && listing.complete))
  useEffect(() => {
    filesRef.current = files
    openRef.current = channel.open
  })
  const stage = useModelStage(shelf.showModels, files)

  const handleSelectFile = useCallback(
    (id: string | null) => {
      if (id === null) return channel.close()
      const file = files.find((candidate) => candidate.id === id)
      if (!file) return
      channel.open(file)
    },
    [files, channel]
  )
  const selectFileRef = useRef(handleSelectFile)
  useEffect(() => {
    selectFileRef.current = handleSelectFile
  }, [handleSelectFile])
  const selectFile = useCallback((id: string | null) => selectFileRef.current(id), [])
  useDocParamSync({
    openId: channel.openId,
    files,
    onUrlOpen: handleSelectFile,
    onUrlClose: channel.close,
  })

  useCompletionToast(paneFiles, shelf)
  useErrorToast(error)

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
  const [describingFolderId, setDescribingFolderId] = useState<string | null>(null)

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
  }, [isDragging])
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
  const requestDetails = useCallback(() => setDetailsWanted(true), [])
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

  const phone = usePhoneLayout()
  const moveInSheet = useMoveInSheet()
  const selection = useDocumentSelection()
  const { exit: exitSelection, set: setSelection, start: startSelection } = selection
  const [moveSheetOpen, setMoveSheetOpen] = useState(false)
  const [rootSortOpen, setRootSortOpen] = useState(false)
  const searchingNow = search.query.trim() !== '' || search.semantic.active
  const sliceOpen = briefSurface.slice !== undefined
  useEffect(() => {
    exitSelection()
  }, [selectedFolderId, searchingNow, sliceOpen, exitSelection])
  const mayPick = canManage && writableHere
  const pickable = useMemo(() => levelFiles.map((file) => file.id), [levelFiles])
  const moveSelection = async (folderId: string | null, folderName: string): Promise<void> => {
    setMoveSheetOpen(false)
    const ids = [...selection.selectedIds]
    exitSelection()
    await moveMany(ids, folderId, folderName)
    void reloadSummary()
  }

  const pickFilesRef = useRef<(() => void) | null>(null)
  const pickFolderRef = useRef<(() => void) | null>(null)
  const uploader = (props: Partial<Parameters<typeof ProjectUppyUpload>[0]>) =>
    canManage && writableHere ? (
      <ProjectUppyUpload
        folderId={selectedFolderId}
        onUpload={handleUpload}
        isUploading={isUploading}
        onSendByMail={shelf.inboundMail?.openAddress}
        {...props}
      />
    ) : undefined

  const mayRootSort = canManage && access.mayWriteAt(null)
  const rootSortShelf = useMemo<RootSortShelf>(
    () => (shelf.projectId ? { kind: 'project', projectId: shelf.projectId } : { kind: 'office_shelf' }),
    [shelf.projectId]
  )
  const openRootSort = useCallback(() => setRootSortOpen(true), [])
  useRootSortParam(mayRootSort, openRootSort)
  const advancedEntries: ActionMenuEntry[] | undefined = mayRootSort
    ? [
        { type: 'label', label: t('rootSort.advanced') },
        {
          type: 'item',
          id: 'root-sort',
          label: t('rootSort.menuItem'),
          onSelect: () => setRootSortOpen(true),
          testId: 'root-sort-trigger',
        },
      ]
    : undefined

  const rootToolsInMenu = phone && !tree.error
  const rootTools = usePhoneRootTools({
    active: rootToolsInMenu,
    onStartSelection: mayPick && !selection.active && !sliceOpen && !searchingNow && levelFiles.length > 0 ? () => startSelection() : undefined,
    onCreateFolder: canManage && writableHere ? (name) => tree.create(name, selectedFolderId ?? undefined) : undefined,
  })

  const controls = (
    <FilesHeaderControls
      phone={phone}
      view={view}
      onViewChange={selectView}
      binHref={shelf.source === 'project' ? undefined : shelf.bin?.href}
      openPointsHref={shelf.source === 'project' ? undefined : shelf.openPoints?.href}
      inboundMail={shelf.source !== 'project' && shelf.inboundMail ? { href: shelf.inboundMail.href, waiting: shelf.inboundMail.waiting } : undefined}
      renderFilter={(compact) => (
        <FileFilterMenu
          canCollaborate={canCollaborate}
          filters={filters}
          onFiltersChange={setFilters}
          sort={sort}
          onSortChange={setSort}
          sortDisabled={search.semantic.active}
          tagOptions={tagOptions}
          compact={compact}
        />
      )}
      search={{
        value: search.query,
        onChange: search.setQuery,
        onSubmit: onOpenSearch ? () => onOpenSearch(search.query.trim()) : search.run,
        onClear: search.clear,
        opensSearch: Boolean(onOpenSearch),
      }}
      upload={phone ? undefined : uploader({ allowFolders: true, pickFilesRef, pickFolderRef })}
      moreEntries={moreEntries}
      levelEntries={rootTools.entries}
      advancedEntries={advancedEntries}
    />
  )

  const inSheet = shelf.source === 'office'
  const uploadFab =
    phone && !selection.active ? uploader({ allowFolders: true, pickFilesRef, pickFolderRef, glyphOnly: true }) : undefined

  const folderDestinations = useMemo(() => sortedFolderDestinations(folders), [folders])
  const { documentActionsAt } = access
  const { askAbout, documentScope } = shelf
  const objectMenu = useCallback(
    (file: FileItem, node: ReactNode, asChild: boolean) => (
      <DocumentObjectMenu
        asChild={asChild}
        document={file}
        scope={documentScope}
        canManage={canManage}
        actions={documentActionsAt(file.folderId)}
        destinations={folderDestinations}
        onOpen={() => selectFile(file.id)}
        onAsk={askAbout ? () => askAbout(file) : undefined}
        onRenamed={handlers.onRenamed}
        onDeleted={handlers.onDeleted}
        onMoved={moved}
        onReingested={handlers.onReingested}
        onSelectMode={mayPick ? () => startSelection(file.id) : undefined}
        moveInSheet={moveInSheet}
      >
        {node}
      </DocumentObjectMenu>
    ),
    [
      documentScope,
      canManage,
      documentActionsAt,
      folderDestinations,
      selectFile,
      askAbout,
      handlers,
      moved,
      mayPick,
      startSelection,
      moveInSheet,
    ]
  )
  const wrapFile = useCallback((file: FileItem, card: ReactNode) => objectMenu(file, card, false), [objectMenu])
  const wrapFileRow = useCallback((file: FileItem, row: ReactNode) => objectMenu(file, row, true), [objectMenu])

  return (
    <FilingSuggestionsProvider
      byDocument={filing.byDocument}
      byFolder={filing.byFolder}
      onSettled={onFilingSettled}
      folderPathOf={folderPathOf}
    >
    <div className="relative flex h-full flex-col" {...(canManage ? surfaceDragHandlers : {})} data-testid="workspace-dropzone">
      <FileDropOverlay
        show={canManage && isDragging}
        isUnsupported={isUnsupportedDrag}
        uploadLabel={dropTargetLabel}
        unsupportedLabel={t('workspace.dropUnsupported')}
        refusal={fileAim ? fileAim.refusal : dropRefusal}
        testId="workspace-drop-overlay"
      />

      {/* The count is a claim about the whole shelf: the summary's on a paged
          level, the drained listing's once its last page is in. */}
      {renderHeader(controls, { count: shelfCount })}

      {error && <UploadProblemAlert message={error} onDismiss={upload.clearError} />}

      <div className="listing-container shrink-0 px-4 md:px-8">
        <UploadTray
          files={activeUploads}
          onRetry={upload.retryFile}
          onCancel={upload.cancelFile}
          onCancelAll={upload.cancelUpload}
          onDismiss={upload.dismissFiles}
          onOpenDocument={handlers.onOpenDocument}
          className={UPLOAD_TRAY_SHEET}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Folder listing failed: say so once, above a browser that falls open
            to the whole corpus, instead of hiding every filed document. */}
        {tree.error && (
          <div className={NOTICE_STRIP}>
            <PaneLoadError message={t('workspace.foldersLoadError')} onRetry={tree.load} inline />
          </div>
        )}
        {/* The drain hit its ceiling: say which documents are missing rather
            than let search, filters and the upload plan pretend to be whole. */}
        {!pagedView && listing.truncated && (
          <div className={NOTICE_STRIP}>
            <Alert>
              <AlertCircle className="size-4" />
              <AlertDescription>{t('workspace.listTruncated', { count: listing.files.length })}</AlertDescription>
            </Alert>
          </div>
        )}

        {/* Mail waiting in the E-Mail-Eingang, said once above the root of a shelf without Dateien's tabs: in a
            project the E-Mail-Eingang tab carries the count, and a line here said it twice. */}
        {shelf.source !== 'project' && shelf.inboundMail && selectedFolderId === null && (shelf.inboundMail.waiting ?? 0) > 0 && (
          <div className={NOTICE_STRIP}>
            <InboundMailWaitingLine href={shelf.inboundMail.href} count={shelf.inboundMail.waiting ?? 0} more={shelf.inboundMail.more} />
          </div>
        )}

        {/* On a phone the Hochladen button floats over the foot of the list, so
            the list ends the button's height plus its 1rem offset and a 1rem gap (6rem) above the screen's edge: the last
            card is never under it. */}
        <div
          className={cn(
            'scroll-fade-bottom min-h-0 min-w-0 flex-1 overflow-y-auto',
            inSheet && !uploadFab && 'pb-[env(safe-area-inset-bottom)]',
            uploadFab && (inSheet ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]' : 'pb-24')
          )}
        >
          {listingError ? (
            <PaneLoadError message={t('workspace.documentsLoadError')} onRetry={retryListing} />
          ) : (
            <FileBrowserPane
              files={levelFiles}
              searchFiles={filteredFiles}
              showOlderRevisions={filters.showOlderRevisions}
              selectedFileId={channel.openId}
              onSelectFile={selectFile}
              isLoading={(pagedView ? level.isLoading : listing.isLoading) || tree.isFirstLoad}
              {...(pagedView
                ? {
                    paging: {
                      hasMore: level.hasMore,
                      loading: level.isLoadingMore,
                      failed: level.moreError,
                      onLoadMore: level.loadMore,
                    },
                    folderStats,
                    shelfEmpty: summaryTallies ? summaryTallies.total === 0 : undefined,
                    searchMatchesNamesOnly: true,
                  }
                : {})}
              search={search}
              view={view}
              onViewChange={selectView}
              sort={sort}
              onSortChange={setSort}
              showAssignment={canCollaborate}
              filterEmptyNotice={filterEmptyNotice}
              onDropDocumentInFolder={canManage ? dropInFolder : undefined}
              onDropFolderInFolder={canManage ? tree.move : undefined}
              onDropFilesInFolder={canManage ? dropFilesInFolder : undefined}
              onFileAim={setFileAim}
              onPickFiles={canManage ? () => pickFilesRef.current?.() : undefined}
              onPickFolder={canManage ? () => pickFolderRef.current?.() : undefined}
              wrapFile={wrapFile}
              wrapFileRow={wrapFileRow}
              renderActions={renderDocumentActions}
              {...(tree.error
                ? {}
                : {
                    folderNav: {
                      folders,
                      currentFolderId: selectedFolderId,
                      onNavigate: selectFolder,
                      onCreateFolder: tree.create,
                      onRenameFolder: tree.rename,
                      onDeleteFolder: tree.remove,
                      readOnly: !canManage,
                      onDescribeFolder: canManage ? setDescribingFolderId : undefined,
                      ...access.folderNav,
                    },
                  })}
              uploadControl={uploader({
                variant: 'default',
                size: 'default',
                label: t('workspace.uploadDocuments'),
              })}
              brief={briefSurface.brief}
              slice={briefSurface.slice}
              rootToolsInMenu={rootToolsInMenu}
              selection={
                mayPick
                  ? {
                      active: selection.active,
                      selectedIds: selection.selectedIds,
                      onToggle: selection.toggle,
                      onStart: sliceOpen ? undefined : () => startSelection(),
                    }
                  : undefined
              }
            />
          )}
        </div>
      </div>

      {selection.active && (
        <SelectionBar
          count={selection.selectedIds.size}
          total={pickable.length}
          canMove={folderDestinations.length > 0}
          onSelectAll={() => setSelection(pickable)}
          onMove={() => setMoveSheetOpen(true)}
          onDone={exitSelection}
        />
      )}
      {uploadFab && <UploadFab inSheet={inSheet}>{uploadFab}</UploadFab>}
      {rootTools.dialog}
      <FolderPickerSheet
        open={moveSheetOpen}
        onOpenChange={setMoveSheetOpen}
        title={t('picker.titleMany', { count: selection.selectedIds.size })}
        destinations={folderDestinations}
        currentFolderId={tree.error ? undefined : selectedFolderId}
        onPick={(folderId, folderName) => void moveSelection(folderId, folderName)}
      />

      {/* „Wollen Sie aktualisieren?" — the plan a dropped folder opens, before
          anything moves. Rendered unconditionally so its own exit transition
          runs; `open` is what decides. */}
      <FolderUploadDialog
        open={shelfUpload.decision.open}
        onOpenChange={shelfUpload.decision.setOpen}
        plan={shelfUpload.decision.plan}
        currentFolderName={
          selectedFolderId ? (folders.find((folder) => folder.id === selectedFolderId)?.name ?? null) : null
        }
        onConfirm={shelfUpload.applyFolderPlan}
        pending={shelfUpload.decision.pending}
        kind={shelfUpload.decision.kind}
        onReleaseChange={shelfUpload.onReleaseChange}
        onRevisionChange={shelfUpload.onRevisionChange}
      />

      {/* What belongs in a folder (migration 0145), on both shelves. */}
      <FolderDescriptionDialog
        folder={folders.find((folder) => folder.id === describingFolderId) ?? null}
        onOpenChange={(next) => !next && setDescribingFolderId(null)}
        onSave={tree.describe}
      />

      {/* Who may read and write a folder (ADR-0088), a project's only. Saving
          moves and re-reads the folder's documents, so both listings are read
          again. */}
      {mayRootSort && (
        <RootSortDialog
          shelf={rootSortShelf}
          open={rootSortOpen}
          onOpenChange={setRootSortOpen}
          onApplied={() => void reloadAll()}
        />
      )}

      {shelf.folderAccess && (
        <FolderAccessDialog
          open={access.editingFolderId !== null}
          onOpenChange={(next) => !next && access.setEditingFolderId(null)}
          projectId={shelf.folderAccess.projectId}
          folder={folders.find((folder) => folder.id === access.editingFolderId) ?? null}
          onSaved={() => {
            void tree.load()
            void reloadAll()
          }}
        />
      )}

      {shelf.preview.kind === 'dialog' && (
        <FilePreviewDialog
          file={channel.dialogFile}
          canManage={canManage}
          scope={shelf.documentScope}
          onClose={channel.close}
          showModels={shelf.showModels}
          onReingested={handlers.onReingested}
          onTagsUpdated={handlers.onTagsUpdated}
          onOpenDocument={handlers.onOpenDocument}
          onRevisionChanged={handlers.onRevisionChanged}
          onMarksChanged={handlers.onMarksChanged}
          onRenamed={handlers.onRenamed}
          onDeleted={handlers.onDeleted}
        />
      )}

      {/* The model, when the URL names one — full screen inside a popup, so the
          page it opened from is still visible at the edges. A project resolves
          the file by name itself; the office Archiv has no project to resolve
          it in, so it needs the document the listing already holds. */}
      {stage.stageModel && (shelf.projectId !== null || stage.stageDocument) && (
        <ModelStage
          projectId={shelf.projectId}
          documentId={stage.stageDocument?.id}
          onClose={stage.closeModel}
          onModelRenamed={handlers.onRenamed}
          onModelDeleted={handlers.onDeleted}
          canCollaborate={canCollaborate}
        />
      )}

      {compareElement}
    </div>
    </FilingSuggestionsProvider>
  )
}

function useFolderBriefSurface({
  shelf,
  brief,
  folders,
  selectedFolderId,
  onOpenFolder,
  onReingested,
  onReadAgainDone,
  onRequestDetails,
  detailsLoading,
  mayReadAgain,
}: {
  shelf: FileShelf
  brief: FolderBriefData | null
  folders: readonly FolderItem[]
  selectedFolderId: string | null
  onOpenFolder: (id: string | null) => void
  onReingested: (id: string, status: string) => void
  onReadAgainDone: () => void
  onRequestDetails: () => void
  detailsLoading: boolean
  mayReadAgain: boolean
}) {
  const t = useTranslations(filesCopy)
  const [collapsed, setCollapsed] = useBriefCollapsed(usePhoneLayout())
  const [selection, setSelection] = useState<{ folderId: string | null; selection: BriefSelection } | null>(null)
  const bulk = useBulkReingest(onReingested)
  const missing = useMissingDocuments(shelf.projectId)
  const findingsResponse = useDocumentFindings(shelf.projectId ?? undefined, { refreshKey: String(brief?.tally.readable ?? 0) })
  const findings = shelf.projectId && findingsResponse ? { projectId: shelf.projectId, response: findingsResponse } : null
  const folderName = selectedFolderId
    ? (folders.find((folder) => folder.id === selectedFolderId)?.name ?? null)
    : null
  const partial = brief?.partial === true

  const active = selection && selection.folderId === selectedFolderId ? selection.selection : null

  const failedIds = brief?.attention.failed
  const readAgain = useCallback(async () => {
    const ids = offeredForRetry(failedIds ?? []).map((file) => file.id)
    const result = await bulk.run(ids)
    const started = result.done - result.failed - (result.unchanged ?? 0)
    if (started > 0) toast.success(t('brief.readAgainDone', { count: started }))
    if (result.failed > 0) toast.error(t('brief.readAgainPartial', { count: result.failed }))
    onReadAgainDone()
  }, [failedIds, bulk, t, onReadAgainDone])

  const sliceLabel = (current: BriefSelection): string => {
    const what =
      current.kind === 'tag'
        ? current.tag
        : current.kind === 'topic'
          ? current.topic
          : current.kind === 'state'
            ? t(`brief.slice.${current.state}`)
            : t(`brief.slice.${current.kind}`)
    const where = folderName ? t('brief.sliceScopeFolder', { name: folderName }) : t('brief.sliceScopeRoot')
    return `${what} · ${where}`
  }

  const select = (next: BriefSelection) => {
    setSelection({ folderId: selectedFolderId, selection: next })
    if (partial) onRequestDetails()
  }

  return {
    brief: brief ? (
      <FolderBrief
        brief={brief}
        folderName={folderName}
        shelfKind={shelf.source}
        onSelect={select}
        onOpenFolder={onOpenFolder}
        onReadAgain={mayReadAgain ? () => void readAgain() : undefined}
        readAgainProgress={bulk.progress}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        missing={missing}
        findings={findings}
        hasSubfolders={folders.some((folder) => folder.parentId === selectedFolderId)}
        onLoadDetails={partial ? onRequestDetails : undefined}
        detailsLoading={detailsLoading}
      />
    ) : null,
    slice: active
      ? {
          files: brief && !partial ? selectInBrief(brief, active) : NO_FILES,
          loading: !brief || partial,
          label: sliceLabel(active),
          onClear: () => setSelection(null),
        }
      : undefined,
  }
}

function useFolderAccess(shelf: FileShelf, folders: readonly FolderItem[], treeRootAccess: FolderAccessLevel) {
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

function useCompletionToast(files: FileItem[], shelf: FileShelf): void {
  const t = useTranslations(filesCopy)
  const { source, messages } = shelf
  useIngestionCompleteToast(
    files,
    useCallback(
      (file: FileItem) => {
        const isModel =
          inferDocumentKind({ filename: file.filename, contentType: file.contentType, tags: file.tags }) ===
          'model'
        const Icon = isModel ? Boxes : source === 'office' ? Archive : FileText
        toast.success(
          isModel
            ? t('toast.modelReady', { name: documentDisplayName(file) })
            : messages.ingestionComplete(documentDisplayName(file)),
          { icon: <Icon className="size-4" style={{ color: sourceBase(source) }} aria-hidden /> }
        )
      },
      [t, source, messages]
    )
  )
}

function useErrorToast(error: string | null): void {
  const lastToasted = useRef<string | null>(null)
  useEffect(() => {
    if (error && error !== lastToasted.current) {
      lastToasted.current = error
      toast.error(error)
    }
    if (!error) lastToasted.current = null
  }, [error])
}

function PaneLoadError({
  message,
  onRetry,
  inline = false,
}: {
  message: string
  onRetry: () => void
  inline?: boolean
}) {
  const t = useTranslations(filesCopy)
  const retry = (
    <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={onRetry} data-attr="files-pane-retry">
      <RotateCcw className="size-3.5" aria-hidden />
      {t('workspace.tryAgain')}
    </Button>
  )
  if (!inline) return <EmptyState variant="bare" icon={AlertCircle} title={message} action={retry} />
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-sm">
      <AlertCircle className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{message}</span>
      {retry}
    </div>
  )
}

const NOTICE_STRIP = 'listing-container px-4 pt-3 md:px-8'
