'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { FileItem, FolderItem } from '../file-types'
import type { DocumentWireRow } from '../lib/file-item'
import type { FileShelf } from '../lib/file-shelf'
import type { RootSortShelf } from '@/lib/filing/root-sort-types'
import { usePhoneLayout } from '../hooks/use-phone-layout'
import { useFileWorkspaceListing } from '../hooks/use-file-workspace-listing'
import { useFileWorkspaceChanges } from '../hooks/use-file-workspace-changes'
import { useFileWorkspacePreview } from '../hooks/use-file-workspace-preview'
import { useFileWorkspaceUploads } from '../hooks/use-file-workspace-uploads'
import { useFileWorkspaceDrop } from '../hooks/use-file-workspace-drop'
import { useFileWorkspaceView } from '../hooks/use-file-workspace-view'
import { useCompletionToast } from '../hooks/use-completion-toast'
import { useErrorToast } from '../hooks/use-error-toast'
import { useDocumentSelection } from '../hooks/use-document-selection'
import { useRootSortParam } from '../hooks/use-root-sort-param'
import { DocumentActionsTrigger, DocumentObjectMenu, useMoveInSheet } from './document-actions'
import { FileBrowserPane } from './file-browser-pane'
import { InboundMailWaitingLine } from './inbound-mail-waiting-line'
import { FileDropOverlay } from './file-drop-overlay'
import { FileFilterMenu } from './file-filter-menu'
import { FilePreviewDialog } from './file-preview-dialog'
import { FolderPickerSheet } from './folder-picker-sheet'
import { RootSortDialog } from './root-sort/root-sort-dialog'
import { SelectionBar } from './selection-bar'
import { sortedFolderDestinations } from '../lib/folder-path-label'
import { FilesHeaderControls } from './files-header-controls'
import { usePhoneRootTools } from './phone-root-tools'
import { FolderAccessDialog } from './folder-access-dialog'
import { FolderDescriptionDialog } from './folder-description-dialog'
import { FilingSuggestionsProvider } from './filing-suggestion'
import { FolderUploadDialog } from './folder-upload-dialog'
import { ProjectUppyUpload } from './project-uppy-upload'
import { UploadTray } from './upload-tray'
import { UPLOAD_TRAY_SHEET } from './upload-tray-sheet'
import { UploadProblemAlert } from './upload-anyway'
import { UploadFab } from './upload-fab'
import { PaneLoadError } from './pane-load-error'

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
  renderFolderNotice?: (folder: { folderId: string; className: string; reload: () => void }) => ReactNode
}

const renderDocumentActions = (): ReactNode => <DocumentActionsTrigger />

export function FileWorkspace({
  shelf,
  renderHeader,
  moreEntries,
  onOpenSearch,
  initialFolders,
  initialFiles,
  initialNextCursor = null,
  initialFolderId = null,
  renderFolderNotice,
}: FileWorkspaceProps) {
  const t = useTranslations(filesCopy)
  const { canManage, canCollaborate } = shelf
  const state = useFileWorkspaceListing({ shelf, initialFolders, initialFiles, initialNextCursor, initialFolderId })
  const {
    selectView,
    selectedFolderId,
    selectFolder,
    filters,
    setFilters,
    sort,
    setSort,
    search,
    pagedView,
    listing,
    level,
    tree,
    paneFiles,
    reloadSummary,
    reloadAll,
  } = state
  const { folders } = tree
  const changes = useFileWorkspaceChanges({ shelf, state })
  const {
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
  } = changes
  const {
    handlers,
    channel,
    compareElement,
    stage,
    selectFile,
  } = useFileWorkspacePreview({ shelf, state })
  useCompletionToast(paneFiles, shelf)
  useErrorToast(error)
  const {
    activeUploads,
    filing,
    onFilingSettled,
    folderPathOf,
  } = useFileWorkspaceUploads({ shelf, state, changes })
  const [describingFolderId, setDescribingFolderId] = useState<string | null>(null)
  const {
    isDragging,
    isUnsupportedDrag,
    dropRefusal,
    surfaceDragHandlers,
    dropTargetLabel,
    fileAim,
    setFileAim,
    dropFilesInFolder,
  } = useFileWorkspaceDrop({ shelf, state, changes })
  const {
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
  } = useFileWorkspaceView({ shelf, state, writableHere, handlers })
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

        {renderFolderNotice && selectedFolderId !== null && !searchingNow &&
          renderFolderNotice({ folderId: selectedFolderId, className: NOTICE_STRIP, reload: () => void reloadAll() })}

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

const NOTICE_STRIP = 'listing-container px-4 pt-3 md:px-8'
