'use client'

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
import { HiddenDevChrome } from '../inbound-mail/dev-chrome'
import { FILES as BROWSER_FILES, FOLDERS as BROWSER_FOLDERS, useFixtureFolderNav } from '../file-browser/fixtures'
import { PROJECT_NAME } from '../inbound-mail/fixture-base'
import { MANY_FOLDERS, REAL_FILES, REAL_FINDINGS, REAL_FOLDERS } from './fixtures'

const projectNameFor = (real: boolean): string => (real ? PROJECT_NAME : 'Wohnhaus Lindengasse')

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
  const folderNav = { ...fixtureNav, onDescribeFolder: () => {} }
  const search = useFileSearch(projectSearchScope('proj-demo'))
  const query = params?.get('q')
  const { setQuery } = search
  useEffect(() => {
    if (query) setQuery(query)
  }, [query, setQuery])
  const levelFiles = FILES.filter((file) => (file.folderId ?? null) === folderNav.currentFolderId)
  const picked = new Set(levelFiles.slice(0, 2).map((file) => file.id))
  const currentFolderName = FOLDERS.find((folder) => folder.id === folderNav.currentFolderId)?.name ?? null
  const projectName = projectNameFor(real)

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
            levelEntries={
              phone
                ? [
                    { type: 'item', id: 'select', label: 'Auswählen', icon: CheckSquare, onSelect: () => {} },
                    { type: 'item', id: 'new-folder', label: 'Ordner anlegen', icon: FolderPlus, onSelect: () => {} },
                  ]
                : undefined
            }
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
              uploadControl={<ProjectUppyUpload onUpload={() => {}} isUploading={false} allowFolders onSendByMail={() => {}} />}
              selectedFileId={selected}
              onSelectFile={setSelected}
              isLoading={false}
              search={search}
              view={view}
              onViewChange={setView}
              folderNav={folderNav}
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
  const chrome = params?.get('chrome') === '0' ? <HiddenDevChrome /> : null
  if (!inShell) {
    return (
      <>
        <FilesPage />
        {chrome}
      </>
    )
  }
  return (
    <DevRailShell projectId="dev" projectName={projectNameFor(real)} pathname="/app/projects/dev/files">
      <FilesPage inShell />
      {chrome}
    </DevRailShell>
  )
}
