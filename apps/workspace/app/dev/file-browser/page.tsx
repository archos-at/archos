'use client'

/**
 * Dev preview for the Files browser — the Finder-style drill-down that
 * replaced the folder tree. Fixtures:
 *
 *  1. The default browser: breadcrumb path row ("All Files › …"), the folder
 *     brief folded to its one line (click it to open), folder cards beside file
 *     cards at the current level, the New-folder popover, and the cards/list
 *     view toggle. Clicking a folder card drills in; the breadcrumb
 *     walks back out.
 *  2. A flat reference grid (no `folderNav`) — the Archiv's presentation.
 *  3. A standalone `FileSearchBar` with a live query so the enlarged clear (X)
 *     hit target is visible.
 *
 * A module-scope fetch shim 404s thumbnails so the SVG sketch fallback
 * renders. 404s outside development.
 *
 * `?variant=search-failed` renders the state a semantic search lands in when it
 * could not RUN. The hook fails open to an empty hit list so the pane cannot
 * crash, and it says which of the two happened — but nothing read that flag, so
 * a backend timeout rendered as "no semantic matches for <query>": the pane told
 * the reader something about their own corpus that it had no way of knowing, and
 * offered them a reset for it. The fixture makes the search endpoint 500 and
 * runs a query, which is the only way to see the state at all.
 *
 * `?variant=search-list` is a semantic search answered in the DETAIL view. The
 * view toggle used to be read only on the un-searched branch, so pressing Enter
 * threw a reader who had chosen the list back into cards. The fixture's hits are
 * deliberately not in upload order, so the shot also shows the ranking surviving
 * into a view whose default sort is newest-first.
 *
 * `?variant=folder-rename` and `?variant=folder-menu` render the two states a
 * folder card only reaches through an interaction: its name swapped for an
 * in-place editor, and the per-card ⋯ menu that gets it there. Both drive
 * themselves — the rename editor is internal component state, and the card
 * controls are hover-revealed on a pointer device, so a fixture that merely
 * rendered the grid would be a picture of neither.
 *
 * `?variant=uploading` renders the moment right after a batch lands, which is
 * the one row where the cards are NOT all the same shape: a document that is
 * still being read has no AI summary yet, while its neighbours do. That is the
 * state the grid used to render badly — the shorter card kept its natural
 * height inside a stretched grid cell and its size · time footer floated in the
 * middle of the tile with dead space underneath. One card in the fixture also
 * has its page thumbnail already rendered while the badge still says
 * "Processing", because a PDF preview is produced at upload time and the rest of
 * ingestion runs after it.
 *
 * The default browser also shows what is still open on a document: the
 * Anmerkungen chip in a card's footer and beside the name in the list
 * („4 offene Anmerkungen, 2 für Sie"), on `Einreichplan_Grundriss_EG_Index-C.pdf`
 * at the root and `Statik_Positionsplan.pdf` in Statik.
 *
 * `?variant=revisions` renders documents with Fassungen (ADR-0099): the count
 * beside the name, the one badge on an older Fassung, in cards and in the list,
 * with older Fassungen hidden and shown. See `revisions-fixture.tsx`.
 */

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { FileBrowserPane } from '@/features/documents/components/file-browser-pane'
import { DocumentActionsTrigger, DocumentObjectMenu } from '@/features/documents/components/document-actions'
import { FileSearchBar, FileSearchField } from '@/features/documents/components/file-search-bar'
import { FileFilterMenu } from '@/features/documents/components/file-filter-menu'
import { FilesHeaderControls } from '@/features/documents/components/files-header-controls'
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

/**
 * Picking several files, the way the workspace composes it: the pane in
 * selection mode, the bar at the foot of the column, and (`move-sheet`) the
 * folder sheet „Verschieben" opens. Two photos are already picked so the shot
 * shows both marks and the count.
 */
function SelectionFixture({ view, sheetOpen = false }: { view: 'cards' | 'list'; sheetOpen?: boolean }): JSX.Element {
  const folderNav = useFixtureFolderNav()
  const search = useFileSearch(projectSearchScope('proj-demo'))
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(['p3', 'p4']))
  const [sheet, setSheet] = useState(sheetOpen)
  const levelFiles = FILES.filter((f) => (f.folderId ?? null) === folderNav.currentFolderId)
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <h1 className="text-lg font-medium">Files browser — selection</h1>
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

/**
 * The phone's floating Hochladen: the pane in a column that ends a button's
 * height above the foot, with the workspace's own `UploadFab` over it. Scroll
 * the list to its end to see that the last card is clear of the button.
 */
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

/** Local folder-navigation state over the fixture's static folders. */

/**
 * A folder lit up as a drop target, mid-drag.
 *
 * The state only exists THROUGH a drag, so the fixture performs one rather than
 * setting a flag: a `dragover` carrying our own folder MIME type, dispatched at
 * a folder card after mount. Setting the highlight directly would be a picture
 * of the state rather than the tile arriving in it, and it is the arriving that
 * this pins — the target has to decide, during the drag and before the release,
 * whether it can take what is over it.
 *
 * The shot is worth having because two surfaces used to answer this gesture at
 * once. The workspace's upload overlay reacted to any drag with items on it, so
 * dragging INSIDE the page covered the folder being aimed at in „Dateien hier
 * ablegen". What this shows is one answer: the folder, ringed.
 */
function FolderDropTargetFixture(): JSX.Element {
  const folderNav = useFixtureFolderNav()
  const search = useFileSearch(projectSearchScope('proj-demo'))

  useEffect(() => {
    const card = document.querySelector('[data-testid="folder-card-f-statik"]')
    if (!card) return
    const types = ['application/x-grid-folder-id', 'application/x-grid-folder-id:f-brand']
    const event = new Event('dragover', { bubbles: true, cancelable: true })
    // jsdom and the browser both refuse a constructed `DataTransfer` here, so
    // the one fact the target reads is attached directly.
    Object.defineProperty(event, 'dataTransfer', {
      value: { types, getData: () => 'f-brand', dropEffect: 'none' },
    })
    const raf = window.requestAnimationFrame(() => card.dispatchEvent(event))
    return () => window.cancelAnimationFrame(raf)
  }, [])

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-medium">Files browser — a folder as a drop target</h1>
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

/**
 * Folders in the DETAIL view — the one composition of this pane that had no shot at all.
 *
 * Every existing file-browser target photographs the card grid, or a search. The
 * detail view's folder band was captured nowhere, which is how it came to be
 * drawn in raw `amber-*` — a band of tinted rows above a neutral table, reading
 * as a warning strip over a listing where nothing is wrong. The shot exists so
 * the next change to either half is seen against the other.
 */
function FoldersInListViewFixture(): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const folderNav = useFixtureFolderNav()
  const search = useFileSearch(projectSearchScope('proj-demo'))
  const levelFiles = FILES.filter((f) => (f.folderId ?? null) === folderNav.currentFolderId)

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-medium">Files browser — folders in the detail view</h1>
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

/**
 * Types a query and submits it, the way the failed-search fixture does — this
 * state only exists THROUGH a search, and setting it directly would be a
 * picture of the state rather than the pane arriving in it.
 */
function useSelfDrivenSearch(testId: string, query: string): void {
  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"] input`)
    if (!input) return
    // React tracks the input's value on the node, so a plain assignment is
    // swallowed; going through the prototype setter is what makes `input` fire.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const submit = window.requestAnimationFrame(() => {
      input.closest('form')?.requestSubmit()
    })
    return () => window.cancelAnimationFrame(submit)
  }, [testId, query])
}

/** A ranked semantic answer, rendered in the view the reader actually chose. */
function SearchInListViewFixture(): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const search = useFileSearch(projectSearchScope('proj-demo'))
  useSelfDrivenSearch('file-browser-search-list', 'Fluchtwegbreite')

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-medium">Files browser — a search answered in the detail view</h1>
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

/**
 * Right-click on a file card — Finder-shaped, same items as the ⋯.
 */
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
        <h1 className="text-lg font-medium">Files browser — right-click a file</h1>
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

/**
 * The folder card's two interaction-only states.
 *
 * `mode="menu"` opens the ⋯ menu on a card — which is also the only way to SEE
 * the card controls on a pointer device, since they are hover-revealed
 * (`data-[state=open]:opacity-100` keeps the trigger lit while its menu is up).
 * `mode="rename"` goes one step further and picks Rename, so the card's name is
 * replaced in place by its own field. The two cannot share a page: the rename
 * input commits on blur, so opening a menu anywhere else would end the rename.
 */
function FolderCrudFixture({ mode }: { mode: 'menu' | 'rename' }): JSX.Element {
  const folderNav = useFixtureFolderNav()
  const search = useFileSearch(projectSearchScope('proj-demo'))

  // `reactStrictMode` runs an effect twice on mount, and Enter on the trigger
  // TOGGLES the menu — so an unguarded effect opened it and immediately shut it
  // again. The ref makes the drive run once; there is deliberately no cleanup,
  // because Strict Mode's cleanup would cancel the frame the first pass queued.
  const driven = useRef(false)
  useEffect(() => {
    if (driven.current) return
    driven.current = true
    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="folder-actions-f-brand"]')
    if (!trigger) return
    // Driven by KEYBOARD, not `.click()`: the trigger opens on pointerdown,
    // which a synthetic click never produces. Enter opens the menu and moves
    // focus to the first item, so a second Enter picks Rename — the same two
    // keystrokes a reader who never touches the mouse would use.
    const press = (node: Element | null) =>
      node?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    trigger.focus()
    press(trigger)
    if (mode === 'menu') return
    // The menu content is portaled and mounts a frame later.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => press(document.activeElement))
    })
  }, [mode])

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-medium">
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

/**
 * A semantic search that could not run.
 *
 * It drives itself — types the query and submits it — because this state is
 * only reachable THROUGH a search, and a fixture that set it directly would be
 * a picture of the state rather than the pane arriving in it.
 */
function SearchFailedFixture(): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const search = useFileSearch(projectSearchScope('proj-demo'))
  useSelfDrivenSearch('file-browser-search-failed', 'Fluchtweg')

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-medium">Files browser — the search could not run</h1>
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

/**
 * The grid a second after an upload: unsettled cards (no summary yet) sharing a
 * row with settled ones. Every tile has to reach the bottom of its cell, so the
 * size · time footers line up across the row whatever the card carries above it.
 */
function JustUploadedFixture(): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const search = useFileSearch(projectSearchScope('proj-demo'))

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-medium">Files browser — a batch that just landed</h1>
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
  // A non-empty query so the search bar's clear (X) target renders in the shot.
  const [barSearch, setBarSearch] = useState('Brandschutz')
  const phone = usePhoneLayout()
  const [filters, setFilters] = useState<FileFilters>(NO_FILE_FILTERS)
  const [sort, setSort] = useState<FileSort>(DEFAULT_FILE_SORT)

  const levelFiles = FILES.filter((f) => (f.folderId ?? null) === folderNav.currentFolderId)
  // The brief as the workspace mounts it: folded to one line, opened on a click.
  const [briefCollapsed, setBriefCollapsed] = useState(true)
  const currentFolderName = FOLDERS.find((folder) => folder.id === folderNav.currentFolderId)?.name ?? null

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-lg font-medium">Files browser — folder drill-down</h1>
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
