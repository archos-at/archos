'use client'

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { FileBrowserPane } from '@/features/documents/components/file-browser-pane'
import { DocumentActionsTrigger, DocumentObjectMenu } from '@/features/documents/components/document-actions'
import { FileSearchBar, FileSearchField } from '@/features/documents/components/file-search-bar'
import { FileFilterMenu } from '@/features/documents/components/file-filter-menu'
import { FilesHeaderControls } from '@/features/documents/components/files-header-controls'
import { FOLDER_DRAG_TYPE } from '@/features/documents/hooks/use-document-drag'
import { usePhoneLayout } from '@/features/documents/hooks/use-phone-layout'
import { NO_FILE_FILTERS, type FileFilters } from '@/features/documents/lib/file-filters'
import { DEFAULT_FILE_SORT, type FileSort } from '@/features/documents/lib/file-sort'
import { FolderPickerSheet } from '@/features/documents/components/folder-picker-sheet'
import { SelectionBar } from '@/features/documents/components/selection-bar'
import { UploadFab } from '@/features/documents/components/upload-fab'
import { ProjectUppyUpload } from '@/features/documents/components/project-uppy-upload'
import { sortedFolderDestinations } from '@/features/documents/lib/folder-path-label'
import { useFileSearch } from '@/features/documents/hooks/use-file-search'
import { projectSearchScope } from '@/features/documents/lib/file-shelf'
import { FILES, UPLOADING_FILES, FOLDERS, useFixtureFolderNav } from './fixtures'
import { RevisionsFixture } from './revisions-fixture'
import { FolderBrief } from '@/features/documents/components/folder-brief'
import { buildFolderBrief } from '@/features/documents/lib/folder-knowledge'

export default function FileBrowserDevPage(): JSX.Element {
  const variant = useSearchParams()?.get('variant') ?? 'default'
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  if (variant === 'uploading') return <JustUploadedFixture />
  if (variant === 'search-failed') return <SearchFailedFixture />
  if (variant === 'search-list') return <SearchInListViewFixture />
  if (variant === 'folder-rename') return <FolderCrudFixture mode="rename" />
  if (variant === 'folder-menu') return <FolderCrudFixture mode="menu" />
  if (variant === 'folders-list') return <FoldersInListViewFixture />
  if (variant === 'folder-drop') return <FolderDropTargetFixture />
  if (variant === 'file-context') return <FileContextMenuFixture />
  if (variant === 'revisions') return <RevisionsFixture />
  if (variant === 'phone-fab') return <PhoneUploadFabFixture />
  if (variant === 'select') return <SelectionFixture view="cards" />
  if (variant === 'select-list') return <SelectionFixture view="list" />
  if (variant === 'move-sheet') return <SelectionFixture view="cards" sheetOpen />
  return <FileBrowserFixtures />
}

function SelectionFixture({ view, sheetOpen = false }: { view: 'cards' | 'list'; sheetOpen?: boolean }): JSX.Element {
  const folderNav = useFixtureFolderNav()
  const search = useFileSearch(projectSearchScope('proj-demo'))
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(['p3', 'p4']))
  const [sheet, setSheet] = useState(sheetOpen)
  const levelFiles = FILES.filter((f) => (f.folderId ?? null) === folderNav.currentFolderId)
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Files browser — selection</h1>
      <div className="flex h-[640px] flex-col overflow-hidden rounded-xl border" data-testid="file-browser-selection">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FileBrowserPane
            files={levelFiles}
            searchFiles={FILES}
            selectedFileId={null}
            onSelectFile={() => {}}
            isLoading={false}
            search={search}
            view={view}
            folderNav={folderNav}
            selection={{
              active: true,
              selectedIds: picked,
              onToggle: (id) =>
                setPicked((current) => {
                  const next = new Set(current)
                  if (!next.delete(id)) next.add(id)
                  return next
                }),
            }}
          />
        </div>
        <SelectionBar
          count={picked.size}
          total={levelFiles.length}
          canMove
          onSelectAll={() => setPicked(new Set(levelFiles.map((file) => file.id)))}
          onMove={() => setSheet(true)}
          onDone={() => setPicked(new Set())}
        />
      </div>
      <FolderPickerSheet
        open={sheet}
        onOpenChange={setSheet}
        title={`${picked.size} Dateien verschieben nach …`}
        destinations={sortedFolderDestinations(FOLDERS)}
        currentFolderId={folderNav.currentFolderId}
        onPick={() => setSheet(false)}
      />
    </main>
  )
}

function PhoneUploadFabFixture(): JSX.Element {
  const folderNav = useFixtureFolderNav()
  const search = useFileSearch(projectSearchScope('proj-demo'))
  const levelFiles = FILES.filter((f) => (f.folderId ?? null) === folderNav.currentFolderId)
  return (
    <main className="flex h-dvh flex-col" data-testid="file-browser-phone-fab">
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-y-auto pb-20">
          <FileBrowserPane
            files={levelFiles}
            searchFiles={FILES}
            selectedFileId={null}
            onSelectFile={() => {}}
            isLoading={false}
            search={search}
            view="cards"
            folderNav={folderNav}
          />
        </div>
        <UploadFab inSheet={false}>
          <ProjectUppyUpload onUpload={() => {}} isUploading={false} allowFolders />
        </UploadFab>
      </div>
    </main>
  )
}

function FolderDropTargetFixture(): JSX.Element {
  const folderNav = useFixtureFolderNav()
  const search = useFileSearch(projectSearchScope('proj-demo'))

  useEffect(() => {
    const card = document.querySelector('[data-testid="folder-card-f-statik"]')
    if (!card) return
    const types = [FOLDER_DRAG_TYPE, `${FOLDER_DRAG_TYPE}:f-brand`]
    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: { types, getData: () => 'f-brand', dropEffect: 'none' },
    })
    const raf = window.requestAnimationFrame(() => card.dispatchEvent(event))
    return () => window.cancelAnimationFrame(raf)
  }, [])

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-semibold">Files browser — a folder as a drop target</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          „Brandschutz“ dragged over „Statik“. One answer to the gesture: the folder, ringed.
        </p>
      </div>
      <div
        className="flex h-[420px] flex-col overflow-hidden rounded-xl border"
        data-testid="file-browser-folder-drop"
      >
        <div className="flex-1 overflow-y-auto">
          <FileBrowserPane
            files={[]}
            searchFiles={FILES}
            selectedFileId={null}
            onSelectFile={() => {}}
            isLoading={false}
            search={search}
            folderNav={folderNav}
            onDropDocumentInFolder={() => {}}
            onDropFolderInFolder={() => {}}
          />
        </div>
      </div>
    </main>
  )
}

function FoldersInListViewFixture(): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const folderNav = useFixtureFolderNav()
  const search = useFileSearch(projectSearchScope('proj-demo'))
  const levelFiles = FILES.filter((f) => (f.folderId ?? null) === folderNav.currentFolderId)

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-semibold">Files browser — folders in the detail view</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The level’s folders as the first rows of the sortable file table, under its head, at the root.
        </p>
      </div>
      <div
        className="flex h-[560px] flex-col overflow-hidden rounded-xl border"
        data-testid="file-browser-folders-list"
      >
        <div className="flex-1 overflow-y-auto">
          <FileBrowserPane
            files={levelFiles}
            searchFiles={FILES}
            selectedFileId={selected}
            onSelectFile={setSelected}
            isLoading={false}
            search={search}
            view="list"
            folderNav={folderNav}
            wrapFileRow={(file, row) => <DocumentObjectMenu document={file} scope="files" folders={FOLDERS} onOpen={() => setSelected(file.id)} asChild>{row}</DocumentObjectMenu>}
            renderActions={() => <DocumentActionsTrigger />} /* as the workspace wires both: each row's menu supplies its ⋯ */
          />
        </div>
      </div>
    </main>
  )
}

function useSelfDrivenSearch(testId: string, query: string): void {
  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"] input`)
    if (!input) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const submit = window.requestAnimationFrame(() => {
      input.closest('form')?.requestSubmit()
    })
    return () => window.cancelAnimationFrame(submit)
  }, [testId, query])
}

function SearchInListViewFixture(): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const search = useFileSearch(projectSearchScope('proj-demo'))
  useSelfDrivenSearch('file-browser-search-list', 'Fluchtwegbreite')

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-semibold">Files browser — a search answered in the detail view</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The ranking survives into a list whose own default is newest-first, and every row shows the passage
          that matched.
        </p>
      </div>

      {/* Mirrors ProjectFileWorkspace's composition: the field lives in the
          header, one component above the pane it filters. */}
      <div className="flex h-[460px] flex-col overflow-hidden rounded-xl border" data-testid="file-browser-search-list">
        <div className="flex items-center justify-end px-4 py-3">
          <FileSearchField
            className="w-72"
            value={search.query}
            onChange={search.setQuery}
            onSubmit={search.run}
            onClear={search.clear}
            placeholder="Dateien durchsuchen"
            searchLabel="Suche"
            resetLabel="Suche zurücksetzen"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          <FileBrowserPane
            files={FILES}
            selectedFileId={selected}
            onSelectFile={setSelected}
            isLoading={false}
            search={search}
            view="list"
          />
        </div>
      </div>
    </main>
  )
}

function FileContextMenuFixture(): JSX.Element {
  const folderNav = useFixtureFolderNav()
  const search = useFileSearch(projectSearchScope('proj-demo'))
  const [selected, setSelected] = useState<string | null>(null)
  const driven = useRef(false)
  useEffect(() => {
    if (driven.current) return
    driven.current = true
    const card = document.querySelector('[data-testid="file-card"]')
    card?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 160 }))
  }, [])
  const levelFiles = FILES.filter((file) => (file.folderId ?? null) === folderNav.currentFolderId)
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-semibold">Files browser — right-click a file</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Open, Ask about this, Download, Rename, Move, Delete. Same list as the ⋯.
        </p>
      </div>
      <div className="h-[520px] overflow-hidden rounded-xl border" data-testid="file-browser-file-context">
        <FileBrowserPane
          files={levelFiles}
          searchFiles={FILES}
          selectedFileId={selected}
          onSelectFile={setSelected}
          isLoading={false}
          search={search}
          folderNav={folderNav}
          wrapFile={(file, card) => (
            <DocumentObjectMenu
              document={file}
              scope="files"
              folders={FOLDERS}
              onOpen={() => setSelected(file.id)}
            >
              {card}
            </DocumentObjectMenu>
          )}
          renderActions={() => <DocumentActionsTrigger />}
        />
      </div>
    </main>
  )
}

function FolderCrudFixture({ mode }: { mode: 'menu' | 'rename' }): JSX.Element {
  const folderNav = useFixtureFolderNav()
  const search = useFileSearch(projectSearchScope('proj-demo'))

  const driven = useRef(false)
  useEffect(() => {
    if (driven.current) return
    driven.current = true
    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="folder-actions-f-brand"]')
    if (!trigger) return
    const press = (node: Element | null) =>
      node?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    trigger.focus()
    press(trigger)
    if (mode === 'menu') return
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => press(document.activeElement))
    })
  }, [mode])

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-semibold">
          {mode === 'menu' ? 'Folder card — the card’s own actions' : 'Folder card — renaming in place'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === 'menu'
            ? 'Rename and Delete on the folder itself, the destructive one carrying its own colour.'
            : 'The name is edited where it already is, not in a dialog that takes it off screen.'}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border" data-testid="folder-crud-fixture">
        <FileBrowserPane
          files={[]}
          searchFiles={FILES}
          selectedFileId={null}
          onSelectFile={() => {}}
          isLoading={false}
          search={search}
          folderNav={folderNav}
        />
      </div>
    </main>
  )
}

function SearchFailedFixture(): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const search = useFileSearch(projectSearchScope('proj-demo'))
  useSelfDrivenSearch('file-browser-search-failed', 'Fluchtweg')

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-semibold">Files browser — the search could not run</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Held apart from “no matches”, which is a statement about the reader’s own files.
        </p>
      </div>

      {/* Mirrors ProjectFileWorkspace's composition: the field lives in the
          header, one component above the pane it filters. */}
      <div className="flex h-[460px] flex-col overflow-hidden rounded-xl border" data-testid="file-browser-search-failed">
        <div className="flex items-center justify-end px-4 py-3">
          <FileSearchField
            className="w-72"
            value={search.query}
            onChange={search.setQuery}
            onSubmit={search.run}
            onClear={search.clear}
            placeholder="Dateien durchsuchen"
            searchLabel="Suche"
            resetLabel="Suche zurücksetzen"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          <FileBrowserPane
            files={FILES}
            selectedFileId={selected}
            onSelectFile={setSelected}
            isLoading={false}
            search={search}
          />
        </div>
      </div>
    </main>
  )
}

function JustUploadedFixture(): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const search = useFileSearch(projectSearchScope('proj-demo'))

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-semibold">Files browser — a batch that just landed</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Two documents still being read (one with its page preview already rendered) beside two that have settled.
        </p>
      </div>

      <div className="h-[420px] overflow-hidden rounded-xl border">
        <FileBrowserPane
          files={UPLOADING_FILES}
          selectedFileId={selected}
          onSelectFile={setSelected}
          isLoading={false}
          search={search}
        />
      </div>
    </main>
  )
}

function FileBrowserFixtures(): JSX.Element {
  const [selected, setSelected] = useState<string | null>('p3')
  const [view, setView] = useState<'cards' | 'list'>('cards')
  const folderNav = useFixtureFolderNav()
  const search = useFileSearch(projectSearchScope('proj-demo'))
  const flatSearch = useFileSearch(projectSearchScope('proj-demo'))
  const [barSearch, setBarSearch] = useState('Brandschutz')
  const phone = usePhoneLayout()
  const [filters, setFilters] = useState<FileFilters>(NO_FILE_FILTERS)
  const [sort, setSort] = useState<FileSort>(DEFAULT_FILE_SORT)

  const levelFiles = FILES.filter((f) => (f.folderId ?? null) === folderNav.currentFolderId)
  const [briefCollapsed, setBriefCollapsed] = useState(true)
  const currentFolderName = FOLDERS.find((folder) => folder.id === folderNav.currentFolderId)?.name ?? null

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-semibold">Files browser — folder drill-down</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Breadcrumb path, folder cards beside the files, New-folder popover, and the cards/list toggle.
          Click a folder card to enter it; the path walks back out.
        </p>
      </div>

      {/* The drill-down browser — mirrors ProjectFileWorkspace's composition:
          view toggle and search field in the header band, the field's own
          results rendered by the pane below it. */}
      <div className="flex h-[720px] flex-col overflow-hidden rounded-xl border">
        {/* The REAL header controls (`FilesHeaderControls`), so this preview
            draws the row the product draws: one row on a phone, the desk's
            toggle, filter and search otherwise. */}
        <div className="px-4 py-3">
          <FilesHeaderControls
            phone={phone}
            view={view}
            onViewChange={setView}
            binHref="/app/projects/dev/files/bin"
            renderFilter={(compact) => (
              <FileFilterMenu
                canCollaborate={false}
                filters={filters}
                onFiltersChange={setFilters}
                sort={sort}
                onSortChange={setSort}
                compact={compact}
              />
            )}
            search={{ value: search.query, onChange: search.setQuery, onSubmit: search.run, onClear: search.clear }}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          <FileBrowserPane
            files={levelFiles}
            searchFiles={FILES}
            selectedFileId={selected}
            onSelectFile={setSelected}
            isLoading={false}
            search={search}
            view={view}
            onViewChange={setView}
            folderNav={folderNav}
            brief={
              <FolderBrief
                brief={buildFolderBrief(FILES, FOLDERS, folderNav.currentFolderId)}
                folderName={currentFolderName}
                shelfKind="project"
                onSelect={() => {}}
                onOpenFolder={folderNav.onNavigate}
                collapsed={briefCollapsed}
                onCollapsedChange={setBriefCollapsed}
              />
            }
            wrapFile={(file, card) => (
              <DocumentObjectMenu
                document={file}
                scope="files"
                folders={FOLDERS}
                onOpen={() => setSelected(file.id)}
              >
                {card}
              </DocumentObjectMenu>
            )}
            renderActions={() => <DocumentActionsTrigger />}
          />
        </div>
      </div>

      {/* Search-bar clear (X) at its enlarged tap size — needs a live query. */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Suche — Löschen (X)</h2>
        <div className="overflow-hidden rounded-xl border">
          <FileSearchBar
            value={barSearch}
            onChange={setBarSearch}
            onSubmit={() => {}}
            onClear={() => setBarSearch('')}
            placeholder="Dokumente durchsuchen"
            searchLabel="Suche"
            resetLabel="Suche zurücksetzen"
            canSearch={false}
            runLabel="Suchen"
            isSearching={false}
            semanticActive={false}
            bannerText=""
            resetSemanticLabel="Zurücksetzen"
            onResetSemantic={() => setBarSearch('')}
            bannerTestId="dev-semantic-banner"
          />
        </div>
      </div>

      {/* Flat reference grid (no folderNav) — the Archiv's presentation. */}
      <div className="h-[820px] overflow-hidden rounded-xl border">
        <FileBrowserPane
          files={FILES}
          selectedFileId={selected}
          onSelectFile={setSelected}
          isLoading={false}
          search={flatSearch}
        />
      </div>
    </main>
  )
}
