'use client'

/**
 * Dev preview of the whole Dateien page, as a project shows it: the section
 * frame (title, subtitle, the places as tabs), the toolbar in its header, the
 * folder brief, the folders and the tiles, on the page and without a test
 * frame around them. `/dev/files-header` holds the header alone and
 * `/dev/file-browser` the browser's states; this one is the composition a
 * person sees, at desk and phone width, for the reviews that score the page
 * as a whole. The fixtures are `/dev/file-browser`'s (`../file-browser/fixtures`).
 * `?rail=1` stands the app rail (and, on a phone, its top band and tab bar)
 * round the page, as the shell does: the rail and Dateien are judged together.
 * `?project=real` draws the project dev showed (`./fixtures.ts`: five folders,
 * two loose files, a finding from the documents), `?folder=<id>` opens a level
 * of it (`r-abgabe-long` is three deep with a long name, `r-deep-5` five deep,
 * `r-test` empty, `r-grund` only folders, `r-berichte` twenty-one files,
 * `r-archiv` two hundred and forty), `?folders=many` puts twenty-four folders at
 * the root, `?view=list` the list, `?picking=1` a selection with its bar,
 * `?brief=open` the brief open, `?q=` a search and `?upload=1` the upload tray,
 * so the states a person walks into are judged too, not only the root.
 * Not linked from anywhere; 404s outside development.
 */

import type { JSX } from 'react'
import { Suspense, useEffect, useState } from 'react'
import { CheckSquare, FolderPlus } from 'lucide-react'
import { notFound, useSearchParams } from 'next/navigation'
import { ProjectSectionActions, ProjectSectionFrame } from '@/components/shell/project-section-frame'
import { DocumentActionsTrigger, DocumentObjectMenu } from '@/features/documents/components/document-actions'
import { FileBrowserPane } from '@/features/documents/components/file-browser-pane'
import { FileFilterMenu } from '@/features/documents/components/file-filter-menu'
import { FilesHeaderControls } from '@/features/documents/components/files-header-controls'
import { FolderBrief } from '@/features/documents/components/folder-brief'
import { SelectionBar } from '@/features/documents/components/selection-bar'
import { UploadTray } from '@/features/documents/components/upload-tray'
import { UPLOAD_TRAY_SHEET } from '@/features/documents/components/upload-tray-sheet'
import type { TrackedFile } from '@/features/documents/types'
import { ProjectUppyUpload } from '@/features/documents/components/project-uppy-upload'
import { UploadFab } from '@/features/documents/components/upload-fab'
import { useFileSearch } from '@/features/documents/hooks/use-file-search'
import { usePhoneLayout } from '@/features/documents/hooks/use-phone-layout'
import type { FileView } from '@/features/documents/hooks/use-view-preference'
import { NO_FILE_FILTERS, type FileFilters } from '@/features/documents/lib/file-filters'
import { projectSearchScope } from '@/features/documents/lib/file-shelf'
import { DEFAULT_FILE_SORT, type FileSort } from '@/features/documents/lib/file-sort'
import { buildFolderBrief } from '@/features/documents/lib/folder-knowledge'
import { primeInboundMailWaiting } from '@/hooks/use-inbound-mail-waiting'
import { I18nProvider } from '@/i18n'
import { DevRailShell } from '../_fixtures/rail-shell'
import { FILES as BROWSER_FILES, FOLDERS as BROWSER_FOLDERS, useFixtureFolderNav } from '../file-browser/fixtures'
import { MANY_FOLDERS, REAL_FILES, REAL_FINDINGS, REAL_FOLDERS } from './fixtures'

/** The project the preview draws, named alike by the rail's selector and the page's crumb. */
const projectNameFor = (real: boolean): string => (real ? 'Holzbau Wien' : 'Wohnhaus Lindengasse')

/** The tracked uploads `?upload=1` shows in the tray: one sending, one queued. */
const UPLOADING: TrackedFile[] = [
  { id: 'up1', fileName: 'Brandschutzkonzept_Wohnhausanlage_Bauteil_C_Index-D.pdf', fileSize: 4_800_000, status: 'uploading', progress: 0, collectionName: 'dev', uploadStartedAt: 1, bytesUploaded: 3_000_000 },
  { id: 'up2', fileName: 'Fluchtwegplan_EG-2OG.pdf', fileSize: 1_200_000, status: 'uploading', progress: 0, collectionName: 'dev' },
]

function FilesPage({ inShell = false }: { inShell?: boolean }): JSX.Element {
  const phone = usePhoneLayout()
  const params = useSearchParams()
  const real = params?.get('project') === 'real'
  const FILES = real ? REAL_FILES : BROWSER_FILES
  const FOLDERS = real ? (params?.get('folders') === 'many' ? MANY_FOLDERS : REAL_FOLDERS) : BROWSER_FOLDERS
  const picking = params?.get('picking') === '1'
  const [view, setView] = useState<FileView>(params?.get('view') === 'list' ? 'list' : 'cards')
  const [filters, setFilters] = useState<FileFilters>(NO_FILE_FILTERS)
  const [sort, setSort] = useState<FileSort>(DEFAULT_FILE_SORT)
  const [selected, setSelected] = useState<string | null>(null)
  const [briefCollapsed, setBriefCollapsed] = useState(params?.get('brief') !== 'open')
  const fixtureNav = useFixtureFolderNav(FOLDERS, params?.get('folder') ?? null)
  // A project member may describe a folder, as the workspace offers it (`onDescribeFolder`).
  const folderNav = { ...fixtureNav, onDescribeFolder: () => {} }
  const search = useFileSearch(projectSearchScope('proj-demo'))
  const query = params?.get('q')
  const { setQuery } = search
  useEffect(() => {
    if (query) setQuery(query)
  }, [query, setQuery])
  const levelFiles = FILES.filter((file) => (file.folderId ?? null) === folderNav.currentFolderId)
  // Two picked, as a person ticks them: the bar floats at the foot as the workspace draws it.
  const picked = new Set(levelFiles.slice(0, 2).map((file) => file.id))
  const currentFolderName = FOLDERS.find((folder) => folder.id === folderNav.currentFolderId)?.name ?? null
  const projectName = projectNameFor(real)

  // The waiting count the rail would have read, for the E-Mail-Eingang tab.
  primeInboundMailWaiting('dev', { count: 3, more: false })
  return (
    <div className={inShell ? 'relative h-full' : 'relative h-dvh'}>
      <ProjectSectionFrame projectId="dev" projectName={projectName} pathname="/app/projects/dev/files" inboundMail>
        <ProjectSectionActions>
          <FilesHeaderControls
            phone={phone}
            view={view}
            onViewChange={setView}
            renderFilter={(compact) => (
              <FileFilterMenu canCollaborate filters={filters} onFiltersChange={setFilters} sort={sort} onSortChange={setSort} compact={compact} />
            )}
            search={{ value: search.query, onChange: search.setQuery, onSubmit: search.run, onClear: search.clear }}
            upload={phone ? undefined : <ProjectUppyUpload onUpload={() => {}} isUploading={false} allowFolders onSendByMail={() => {}} />}
            // A phone's level, as the workspace builds it: the level's tools first in the ⋯.
            levelEntries={
              phone
                ? [
                    { type: 'item', id: 'select', label: 'Auswählen', icon: CheckSquare, onSelect: () => {} },
                    { type: 'item', id: 'new-folder', label: 'Ordner anlegen', icon: FolderPlus, onSelect: () => {} },
                  ]
                : undefined
            }
            // „Erweitert“, the ⋯ after Hochladen that a reader who may sort the root has (`advancedEntries`).
            advancedEntries={real ? [{ type: 'label', label: 'Erweitert' }, { type: 'item', id: 'root-sort', label: 'Projektwurzel sortieren …', onSelect: () => {} }] : undefined}
          />
        </ProjectSectionActions>
        {/* The workspace's own column: the upload tray, then the listing in its scroll box (`FileWorkspace`). */}
        <div className="flex h-full min-h-0 flex-col">
          {params?.get('upload') === '1' && (
            <div className="listing-container shrink-0 px-4 md:px-8">
              <UploadTray files={UPLOADING} onRetry={() => {}} onCancel={() => {}} onCancelAll={() => {}} onDismiss={() => {}} className={UPLOAD_TRAY_SHEET} />
            </div>
          )}
          <div className="scroll-fade-bottom min-h-0 min-w-0 flex-1 overflow-y-auto">
            <FileBrowserPane
              files={levelFiles}
              searchFiles={FILES}
              // The empty level's upload, as the workspace passes it.
              uploadControl={<ProjectUppyUpload onUpload={() => {}} isUploading={false} allowFolders onSendByMail={() => {}} />}
              selectedFileId={selected}
              onSelectFile={setSelected}
              isLoading={false}
              search={search}
              view={view}
              onViewChange={setView}
              folderNav={folderNav}
              // „Auswählen“ in the path row, as a project with files offers it.
              selection={{ active: picking, selectedIds: picking ? picked : new Set(), onToggle: () => {}, onStart: () => {} }}
              rootToolsInMenu={phone}
              brief={
                <FolderBrief
                  brief={buildFolderBrief(FILES, FOLDERS, folderNav.currentFolderId)}
                  folderName={currentFolderName}
                  hasSubfolders={FOLDERS.some((folder) => folder.parentId === folderNav.currentFolderId)}
                  shelfKind="project"
                  onSelect={() => {}}
                  onOpenFolder={folderNav.onNavigate}
                  collapsed={briefCollapsed}
                  onCollapsedChange={setBriefCollapsed}
                  findings={real ? { projectId: 'dev', response: REAL_FINDINGS } : null}
                />
              }
              wrapFile={(file, card) => (
                <DocumentObjectMenu document={file} scope="files" folders={FOLDERS} onOpen={() => setSelected(file.id)}>
                  {card}
                </DocumentObjectMenu>
              )}
              // A list row's menu, as the workspace wraps it (`wrapFileRow`): without it a phone's file rows had no ⋯.
              wrapFileRow={(file, row) => (
                <DocumentObjectMenu asChild document={file} scope="files" folders={FOLDERS} onOpen={() => setSelected(file.id)}>
                  {row}
                </DocumentObjectMenu>
              )}
              renderActions={() => <DocumentActionsTrigger />}
            />
            {/* The workspace ends a phone's list above the floating Hochladen (`pb-24`): the last tiles are never under it. */}
            {phone && <div className="h-24" aria-hidden />}
          </div>
          {/* The selection's bar at the foot of the workspace, under the scrolling list, as `FileWorkspace` draws it. */}
          {picking && <SelectionBar count={picked.size} total={levelFiles.length} canMove onSelectAll={() => {}} onMove={() => {}} onDone={() => {}} />}
        </div>
      </ProjectSectionFrame>
      {/* The phone's Hochladen, floating at the foot as the workspace draws it (`uploadFab`). */}
      {phone && !picking && (
        <UploadFab inSheet={false}>
          <ProjectUppyUpload onUpload={() => {}} isUploading={false} allowFolders glyphOnly onSendByMail={() => {}} />
        </UploadFab>
      )}
    </div>
  )
}

export default function FilesPageDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  // German, pinned: the copy a person reads, and the widest (`?lang=en` for the English one).
  return (
    <Suspense>
      <FilesPageInLocale />
    </Suspense>
  )
}

function FilesPageInLocale(): JSX.Element {
  const locale = useSearchParams()?.get('lang') === 'en' ? 'en' : 'de'
  return (
    <I18nProvider key={locale} initialLocale={locale} fixedLocale>
      <FilesPageInShell />
    </I18nProvider>
  )
}

function FilesPageInShell(): JSX.Element {
  const params = useSearchParams()
  const inShell = params?.get('rail') === '1'
  const real = params?.get('project') === 'real'
  if (!inShell) return <FilesPage />
  return (
    // The rail's project selector names the project the crumb names (it said „Wohnhaus Lindengasse“ over „Holzbau Wien“).
    <DevRailShell projectId="dev" projectName={projectNameFor(real)} pathname="/app/projects/dev/files">
      <FilesPage inShell />
    </DevRailShell>
  )
}
