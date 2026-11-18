'use client'

import { cn } from '@/lib/utils'
import { Fragment, useCallback, useDeferredValue, useMemo, useState, type ReactNode } from 'react'
import type { FileItem, FolderItem } from '../file-types'
import { CheckSquare, Search, FilterX, FolderOpen } from 'lucide-react'
import { RisoPrint } from '@/components/brand/riso-print'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionLabel } from '@/components/ui/section-label'
import { ProjectSectionPlace, useSectionPlaceSlot, useSectionTabActionsSlot } from '@/components/shell/project-section-frame'
import { navCopy } from '@/i18n/namespaces/nav'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { tagLabel } from '@/lib/documents/tag-vocabulary'
import { fileMatchesQuery } from '../lib/file-query-match'
import type { FileSearch } from '../hooks/use-file-search'
import { useCoarsePointer } from '../hooks/use-coarse-pointer'
import { useLevelDirection } from '../hooks/use-level-direction'
import { motion } from '@/components/motion'
import { ActionMenu } from '@/components/ui/action-menu'
import { useMoveInSheet } from './document-actions'
import type { FileCardProps } from './file-card'
import { FileTile } from './file-browser-tile'
import { SemanticSearchResults } from './file-browser-semantic-results'
import { BriefSliceListing } from './file-browser-slice-listing'
import { FilingViewBar } from './filing-bar'
import { FileGrid } from './file-grid'
import { FileListView } from './file-list-view'
import { FolderRow } from './folder-table-row'
import { FolderActionsTrigger, FolderObjectMenu } from './folder-object-menu'
import { FolderDescriptionLine } from './folder-description-dialog'
import { listingActionEntries } from './listing-action-entries'
import { NewFolderDialog } from './new-folder-dialog'
import { DEFAULT_FILE_SORT, sortFiles, type FileSort } from '../lib/file-sort'
import type { KnowledgeTally } from '../lib/folder-knowledge'
import { folderRollupsOf } from '../lib/folder-rollups'
import { LoadMore } from '@/components/ui/load-more'
import { withoutOlderRevisions } from '../lib/revision-chain'
import {
  FolderBreadcrumbRow,
  FolderCard,
  type DropFilesInFolder,
} from './folder-navigation'
import type { FileDropAim } from '../hooks/use-document-drag'
import { CONTENT_MAX, FileBrowserSkeleton, levelTransition } from './file-browser-skeleton'
import { mayWriteAt, type BriefSlice, type FileBrowserSelection, type FolderNavigation } from '../lib/file-browser-contract'
import { canAcceptFolderDrop, folderDepthOf } from '../lib/folder-nesting'
export { mayWriteAt, type FileBrowserSelection, type FolderNavigation } from '../lib/file-browser-contract'

interface FileBrowserPaneProps {
  files: readonly FileItem[]
  sort?: FileSort
  onSortChange?: (next: FileSort) => void
  selectedFileId: string | null
  onSelectFile: (id: string | null) => void
  isLoading: boolean
  filterEmptyNotice?: { title: string; description: string; onClear: () => void } | null
  onDropDocumentInFolder?: (documentId: string, folderId: string | null) => void
  onDropFolderInFolder?: (draggedFolderId: string, parentId: string | null) => void
  onDropFilesInFolder?: DropFilesInFolder
  onFileAim?: (aim: FileDropAim | null) => void
  uploadControl?: ReactNode
  folderNav?: FolderNavigation
  searchFiles?: readonly FileItem[]
  showOlderRevisions?: boolean
  search: FileSearch
  view?: 'cards' | 'list'
  showAssignment?: boolean
  renderActions?: (file: FileItem) => ReactNode
  wrapFile?: (file: FileItem, node: ReactNode) => ReactNode
  wrapFileRow?: (file: FileItem, row: ReactNode) => ReactNode
  onViewChange?: (view: 'cards' | 'list') => void
  onPickFiles?: () => void
  onPickFolder?: () => void
  brief?: ReactNode
  slice?: BriefSlice
  paging?: { hasMore: boolean; loading: boolean; failed: boolean; onLoadMore: () => void }
  folderStats?: { counts: ReadonlyMap<string, number>; tallies: ReadonlyMap<string, KnowledgeTally> }
  shelfEmpty?: boolean
  searchMatchesNamesOnly?: boolean
  selection?: FileBrowserSelection
  rootToolsInMenu?: boolean
}

export function FileBrowserPane({
  files,
  selectedFileId,
  onSelectFile,
  isLoading,
  uploadControl,
  folderNav,
  searchFiles,
  showOlderRevisions = false,
  search,
  view = 'cards',
  showAssignment = false,
  filterEmptyNotice,
  onDropDocumentInFolder,
  onDropFolderInFolder,
  onDropFilesInFolder,
  onFileAim,
  renderActions,
  wrapFile,
  wrapFileRow,
  onViewChange,
  onPickFiles,
  onPickFolder,
  sort = DEFAULT_FILE_SORT,
  onSortChange,
  brief,
  slice,
  paging,
  folderStats,
  shelfEmpty,
  searchMatchesNamesOnly = false,
  selection,
  rootToolsInMenu = false,
}: FileBrowserPaneProps) {
  const t = useTranslations(filesCopy)
  const nav = useTranslations(navCopy)
  const { locale } = useLocale()
  const { semantic } = search
  const { clear: clearSearch } = search
  const searchUp = useMemo(() => ({ label: t('browser.clearSearch'), onSelect: clearSearch }), [t, clearSearch])
  const tabSlot = useSectionTabActionsSlot()
  const placeSlot = useSectionPlaceSlot()
  const toolsGone = tabSlot || rootToolsInMenu
  const rootRowGone = toolsGone && ((folderNav?.currentFolderId ?? null) === null || placeSlot)
  const query = useDeferredValue(search.query)

  const orderedFiles = useMemo(() => sortFiles(files, sort, locale), [files, sort, locale])
  const levelDocumentIds = useMemo(() => files.map((file) => file.id), [files])
  const orderedSlice = useMemo(() => (slice ? sortFiles(slice.files, sort, locale) : []), [slice, sort, locale])

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return orderedFiles
    const matches = (searchFiles ?? files).filter((f) => fileMatchesQuery(f, q, (tag) => tagLabel(tag, t)))
    return sortFiles(withoutOlderRevisions(matches, showOlderRevisions), sort, locale)
  }, [orderedFiles, files, searchFiles, query, sort, locale, showOlderRevisions, t])

  const currentFolderId = folderNav?.currentFolderId ?? null
  const writableHere = mayWriteAt(folderNav, currentFolderId)
  const liftable = Boolean(onDropDocumentInFolder) && writableHere && query.trim() === '' && !semantic.active
  const [createFolderIn, setCreateFolderIn] = useState<string | null | undefined>(undefined)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)

  const touch = useCoarsePointer()
  const listingEntries = useMemo(
    () =>
      listingActionEntries({
        labels: {
          newFolder: t('folders.newFolder'),
          uploadFiles: t('upload.uploadFiles'),
          uploadFolder: t('upload.uploadFolder'),
          viewCards: t('workspace.view.cards'),
          viewList: t('workspace.view.list'),
          sortName: t('list.columns.name'),
          sortStatus: t('list.columns.status'),
          sortSize: t('list.columns.size'),
          sortAdded: t('list.columns.added'),
        },
        view,
        sort,
        onNewFolder:
          folderNav && !folderNav.readOnly && writableHere && !semantic.active && query.trim() === ''
            ? () => setCreateFolderIn(currentFolderId)
            : undefined,
        onUploadFiles: writableHere ? onPickFiles : undefined,
        onUploadFolder: writableHere && !touch ? onPickFolder : undefined,
        onViewChange,
        onSortChange,
      }),
    [
      t,
      view,
      sort,
      folderNav,
      semantic.active,
      query,
      currentFolderId,
      writableHere,
      onPickFiles,
      onPickFolder,
      touch,
      onViewChange,
      onSortChange,
    ],
  )

  const picking = selection?.active === true
  const toggleSelected = selection?.onToggle ?? noToggle
  const moveInSheet = useMoveInSheet()

  const fileCard = (file: FileItem, extra: { match?: FileCardProps['match']; where?: string } = {}) => (
    <FileTile
      file={file}
      isSelected={selectedFileId === file.id}
      onSelectFile={onSelectFile}
      locale={locale}
      match={extra.match}
      showAssignment={showAssignment}
      renderActions={renderActions}
      wrapFile={wrapFile}
      draggable={liftable}
      selecting={picking && !extra.match}
      checked={selection?.selectedIds.has(file.id) === true}
      onToggle={toggleSelected}
      where={extra.where}
    />
  )
  const folderNameOf = (folderId: string | null | undefined): string =>
    (folderId && folderNav?.folders.find((folder) => folder.id === folderId)?.name) || nav('sections.files')

  const folderTile = (folder: FolderItem, asRow: boolean) => {
    const props = {
      folder,
      itemCount: folderItemCount(folder.id),
      lastModified: folderLastModified(folder.id),
      knowledge: folderAggregates.tallies.get(folder.id),
      onOpen: folderNav!.onNavigate,
      onRenameFolder: folderNav!.onRenameFolder,
      onDeleteFolder: folderNav!.onDeleteFolder,
      onDropDocument: onDropDocumentInFolder,
      onDropFolder: onDropFolderInFolder,
      canAcceptFolder,
      onDropFiles: onDropFilesInFolder,
      onFileAim,
      actions: folderNav ? (folderNav.readOnly ? <Fragment /> : <FolderActionsTrigger />) : undefined,
      editing: editingFolderId === folder.id,
      onEditingChange: (next: boolean) => setEditingFolderId(next ? folder.id : null),
      readOnly: folder.access === 'read',
    }
    const tile = asRow ? <FolderRow {...props} /> : <FolderCard {...props} />
    if (!folderNav || folderNav.readOnly) return tile
    return (
      <FolderObjectMenu
        folder={folder}
        folders={folderNav.folders}
        canAcceptMove={(target) => canMoveFolderTo(folder.id, target)}
        onOpen={() => folderNav.onNavigate(folder.id)}
        onNewInside={() => setCreateFolderIn(folder.id)}
        onRename={() => setEditingFolderId(folder.id)}
        onDescribe={
          folderNav.onDescribeFolder && folder.access !== 'read'
            ? () => folderNav.onDescribeFolder?.(folder.id)
            : undefined
        }
        onMove={
          onDropFolderInFolder
            ? (parentId) => void onDropFolderInFolder(folder.id, parentId)
            : undefined
        }
        onAccess={
          folderNav.onEditFolderAccess ? () => folderNav.onEditFolderAccess?.(folder.id) : undefined
        }
        onDelete={() => void folderNav.onDeleteFolder(folder.id)}
        readOnly={folder.access === 'read'}
        moveInSheet={moveInSheet}
        asChild={asRow}
      >
        {tile}
      </FolderObjectMenu>
    )
  }

  const folderDepth = useMemo(() => folderDepthOf(folderNav, currentFolderId), [folderNav, currentFolderId])

  const navDirection = useLevelDirection(folderDepth)

  const canAcceptFolder = useCallback(
    (draggedId: string, targetId: string | null): boolean => canAcceptFolderDrop(folderNav, draggedId, targetId),
    [folderNav]
  )
  const canMoveFolderTo = useCallback(
    (draggedId: string, targetId: string | null) => canAcceptFolder(draggedId, targetId) && mayWriteAt(folderNav, targetId),
    [canAcceptFolder, folderNav]
  )

  const childFolders = useMemo(
    () => (folderNav?.folders ?? []).filter((f) => f.parentId === currentFolderId),
    [folderNav?.folders, currentFolderId]
  )

  const folderAggregates = useMemo(
    () => folderRollupsOf(folderStats, files, searchFiles, folderNav?.folders, showOlderRevisions),
    [folderStats, files, searchFiles, folderNav?.folders, showOlderRevisions]
  )

  const folderItemCount = (folderId: string): number => folderAggregates.counts.get(folderId) ?? 0

  const folderLastModified = (folderId: string): string | null =>
    folderAggregates.tallies.get(folderId)?.latest ?? null

  if (isLoading) {
    return (
      <FileBrowserSkeleton view={view} withFolders={folderNav !== undefined} />
    )
  }

  if (filterEmptyNotice) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          variant="bare"
          icon={FilterX}
          title={filterEmptyNotice.title}
          description={filterEmptyNotice.description}
          action={
            <Button variant="secondary" size="sm" onClick={filterEmptyNotice.onClear}>
              {t('browser.clearFilters')}
            </Button>
          }
        />
      </div>
    )
  }

  const corpusEmpty = shelfEmpty ?? (searchFiles ?? files).length === 0
  if (corpusEmpty && (folderNav?.folders ?? []).length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState variant="bare"
          art={<RisoPrint id="vignetten/planschrank/empty" />}
          title={t('browser.noDocumentsTitle')}
          description={t('browser.noDocumentsDescription')}
          action={uploadControl}
        />
      </div>
    )
  }

  const searching = query.trim() !== ''
  const currentFolder =
    folderNav && currentFolderId ? (folderNav.folders.find((folder) => folder.id === currentFolderId) ?? null) : null
  const levelEmpty = files.length === 0 && childFolders.length === 0 && !paging?.hasMore
  const bothKinds = Boolean(folderNav) && childFolders.length > 0 && orderedFiles.length > 0

  const pagingFooter = paging ? (
    <LoadMore
      hasMore={paging.hasMore}
      loading={paging.loading}
      failed={paging.failed}
      onLoadMore={paging.onLoadMore}
      loadMoreLabel={t('browser.loadMore')}
      loadingLabel={t('browser.loadingMore')}
      failedLabel={t('browser.loadMoreFailed')}
    />
  ) : null

  return (
    <div className="flex min-h-full flex-col">
      {/* No banner over the results. It restated in a tinted strip what the
          listing below it already shows — how many hits, for which query —
          and it moved the whole listing down a row the moment a search ran.
          Everything it carried has a better home: the skeletons say a search
          is running, the empty and failed panels say what came back, and the
          field's own ✕ is the way out. The field itself is the caller's — on
          Files it sits in the page header, one component above this one. */}

      {/* The path, Finder-style: where the reader stands, every ancestor a
          click back out, and "New folder" for the level they are in. Hidden
          while a query is active in either mode (the query is the context and
          its results span the corpus). */}
      {folderNav && !semantic.active && (
        <FolderBreadcrumbRow
          searching={searching}
          itemCount={currentFolderId === null ? undefined : folderItemCount(currentFolderId)}
          emptyLevel={levelEmpty && !searching && !slice}
          folders={folderNav.folders}
          currentFolderId={folderNav.currentFolderId}
          onNavigate={folderNav.onNavigate}
          onCreateFolder={folderNav.readOnly || picking ? undefined : folderNav.onCreateFolder}
          onDropDocument={onDropDocumentInFolder}
          onDropFolder={onDropFolderInFolder}
          canAcceptFolder={canAcceptFolder}
          onDropFiles={onDropFilesInFolder}
          onFileAim={onFileAim}
          mayWriteAt={(folderId) => mayWriteAt(folderNav, folderId)}
          readOnly={!writableHere}
          rootToolsElsewhere={rootToolsInMenu}
        >
          {/* Wherever the reader may file, at a level of folders only too (disabled, nothing to pick): a press that came
              and went moved „Ordner anlegen“ under the pointer (finding 19). */}
          {selection?.onStart && !picking && writableHere && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={selection.onStart}
              disabled={orderedFiles.length === 0}
              title={orderedFiles.length === 0 ? t('selection.nothingToPick') : t('selection.start')}
              data-testid="selection-start"
            >
              <CheckSquare className="size-4" aria-hidden />
              <span className={cn(folderNav.currentFolderId !== null && 'phone:sr-only')}>{t('selection.start')}</span>
            </Button>
          )}
        </FolderBreadcrumbRow>
      )}

      {/* While the field filters, the query is where the reader is: the title says it and how much it found, the crumb
          that it searches the whole of Dateien, and the phone's ← clears it (finding 13). */}
      {searching && placeSlot && (
        <ProjectSectionPlace
          title={t('browser.searchTitle', { query: query.trim() })}
          trail={<span className="shrink-0">{nav('sections.files')}</span>}
          up={searchUp}
          count={paging?.hasMore ? undefined : t('browser.searchCount', { count: filteredFiles.length })}
        />
      )}
      {/* What the agent knows about the level's whole subtree. Hidden while a
          query runs for the same reason the breadcrumb is: the query is the
          context then, and its results span the corpus. */}
      {/* The folder's description, where it has one, as the first line under the tabs; „Beschreiben …“ is in the
          folder's ⋯ one level up. An empty line with its ghost press alone at the column's end was a row of nothing. */}
      {currentFolder?.description && !semantic.active && !searching && (
        <div className={cn(CONTENT_MAX, 'px-4', rootRowGone ? 'pt-0' : 'pt-3')}>
          <FolderDescriptionLine
            folder={currentFolder}
            canEdit={Boolean(folderNav?.onDescribeFolder) && writableHere}
            onEdit={() => folderNav?.onDescribeFolder?.(currentFolder.id)}
          />
        </div>
      )}
      {/* Under the tabs where the root's row went (tabs, ⋯). While picking the bar owns the action: no „Ordner anlegen“. */}
      {brief && !semantic.active && !searching && (
        <div className={cn(CONTENT_MAX, 'px-4 phone:pt-2', rootRowGone && !currentFolder?.description ? 'pt-2' /* its line 24px under the header's rule */ : 'pt-4')}>{brief}</div>
      )}
      {/* The agent's filing suggestions for the documents of this level, one line
          per target folder, when one folder would collect two or more: the
          decision that moves several files, made where they are all in view. */}
      {!semantic.active && !searching && !slice && (
        <FilingViewBar documentIds={levelDocumentIds} className={`${CONTENT_MAX} px-4 pt-4`} />
      )}

      <ActionMenu mode="context" entries={listingEntries}>
      {semantic.active ? (
        <SemanticSearchResults
          search={search}
          view={view}
          selectedFileId={selectedFileId}
          onSelectFile={onSelectFile}
          renderActions={renderActions}
          wrapFileRow={wrapFileRow}
          fileCard={fileCard}
        />
      ) : searching ? (
        filteredFiles.length === 0 && !paging?.hasMore && !paging?.loading ? (
          <div className="p-8">
            <EmptyState
              variant="bare"
              icon={Search}
              title={t('browser.noMatch', { query })}
              description={t(searchMatchesNamesOnly ? 'browser.noMatchNamesDescription' : 'browser.noMatchDescription')}
              action={
                <Button variant="secondary" size="sm" onClick={search.clear}>
                  {t('browser.clearSearch')}
                </Button>
              }
            />
          </div>
        ) : view === 'list' ? (
          <div className={CONTENT_MAX}>
            <FileListView
              files={filteredFiles}
              selectedFileId={selectedFileId}
              onSelectFile={onSelectFile}
              renderActions={renderActions}
              wrapRow={wrapFileRow}
              sort={sort}
              onSortChange={onSortChange}
              selection={selection}
            />
            {pagingFooter}
          </div>
        ) : (
          <div className={`${CONTENT_MAX} p-4`}>
            <FileGrid>
              {filteredFiles.map((file) => (
                <Fragment key={file.id}>{fileCard(file, { where: folderNav ? folderNameOf(file.folderId) : undefined })}</Fragment>
              ))}
            </FileGrid>
            {pagingFooter}
          </div>
        )
      ) : slice ? (
        <BriefSliceListing
          slice={slice}
          orderedSlice={orderedSlice}
          view={view}
          sort={sort}
          onSortChange={onSortChange}
          selectedFileId={selectedFileId}
          onSelectFile={onSelectFile}
          renderActions={renderActions}
          wrapFileRow={wrapFileRow}
          selection={selection}
          fileCard={fileCard}
        />
      ) : levelEmpty ? (
        <motion.div
          key={`empty-${currentFolderId ?? 'root'}`}
          {...levelTransition(navDirection, 16)}
          className={cn(CONTENT_MAX, 'px-4 pt-6')}
        >
          {/* `data-empty-level`: its Hochladen is the pane's one ink press, so the phone's floating one steps out
              (`UploadFab`) and the tool row's steps back (`useSectionPrimaryYields`). A finger cannot drop on a page. */}
          <EmptyState variant="bare" className="items-start py-0 text-left" data-empty-level=""
            icon={FolderOpen}
            title={t('browser.folderEmptyTitle')}
            description={t(touch ? 'browser.folderEmptyDescriptionTouch' : 'browser.folderEmptyDescription')}
            action={writableHere ? uploadControl : undefined}
          />
        </motion.div>
      ) : view === 'list' ? (
        <motion.div
          key={`list-${currentFolderId ?? 'root'}`}
          {...levelTransition(navDirection, 16)}
          className={CONTENT_MAX}
        >
            {(orderedFiles.length > 0 || (folderNav && childFolders.length > 0)) && (
              <FileListView
                folderRows={folderNav && childFolders.length > 0 ? childFolders.map((folder) => <Fragment key={folder.id}>{folderTile(folder, true)}</Fragment>) : undefined}
                files={orderedFiles}
                selectedFileId={selectedFileId}
                onSelectFile={onSelectFile}
                renderActions={renderActions}
                wrapRow={wrapFileRow}
                sort={sort}
                onSortChange={onSortChange}
                draggable={liftable}
                selection={selection}
              />
            )}
            {pagingFooter}
        </motion.div>
      ) : (
        <motion.div
          key={`grid-${currentFolderId ?? 'root'}`}
          {...levelTransition(navDirection, 20)}
          className={`${CONTENT_MAX} px-4 pb-4 pt-6`}
        >
            {/* ONE ENTRANCE FOR THE LEVEL, NOT ONE PER TILE. A `motion.div` per cell compounded with the level's own
                slide, and motion writes `initial` into the server's HTML, so every card shipped at `opacity: 0`
                until hydration. The level's transition carries the grid: one animation, a Finder-style drill. */}
            {/* One grammar at every level: folders first, then files, each labelled when both are there (32px apart, 12px
                over their tiles); a subfolder mixed them and stretched „Index C“ to a thumbnail's height (finding 9). */}
            {folderNav && childFolders.length > 0 && (
              <section aria-label={t('folders.heading')} data-testid="folder-tiles">
                {bothKinds && (
                  <SectionLabel as="p" className="mb-1.5 px-0" /* 12px to the sheets, past the tiles' 6px inset */ data-testid="folders-label">
                    {t('folders.heading')}
                  </SectionLabel>
                )}
                <FileGrid className="md:[grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]" /* a name of one line: 196px cut half */>
                  {childFolders.map((folder) => (
                    <Fragment key={folder.id}>{folderTile(folder, false)}</Fragment>
                  ))}
                </FileGrid>
              </section>
            )}
            {orderedFiles.length > 0 && (
              <section aria-label={t('browser.recentlyUploaded')} className={cn(bothKinds && 'mt-8')}>
                {bothKinds && (
                  <SectionLabel as="p" className="mb-1.5 px-0">
                    {t('browser.recentlyUploaded')}
                  </SectionLabel>
                )}
                <FileGrid>
                  {orderedFiles.map((file) => (
                    <Fragment key={file.id}>{fileCard(file)}</Fragment>
                  ))}
                </FileGrid>
              </section>
            )}
            {pagingFooter}
        </motion.div>
      )}
      </ActionMenu>
      {folderNav && !folderNav.readOnly && (
        <NewFolderDialog
          open={createFolderIn !== undefined}
          onOpenChange={(open) => {
            if (!open) setCreateFolderIn(undefined)
          }}
          onCreate={(name) => folderNav.onCreateFolder(name, createFolderIn ?? undefined)}
        />
      )}
    </div>
  )
}

const noToggle = (): void => undefined
