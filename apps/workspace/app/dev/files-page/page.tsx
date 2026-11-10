'use client'

/**
 * Dev preview of the whole Dateien page, as a project shows it: the section
 * frame (title, subtitle, the places as tabs), the toolbar in its header, the
 * folder brief, the folders and the tiles, on the page and without a test
 * frame around them. `/dev/files-header` holds the header alone and
 * `/dev/file-browser` the browser's states; this one is the composition a
 * person sees, at desk and phone width, for the reviews that score the page
 * as a whole. The fixtures are `/dev/file-browser`'s (`../file-browser/fixtures`).
 * Not linked from anywhere; 404s outside development.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { CheckSquare, FolderPlus } from 'lucide-react'
import { notFound } from 'next/navigation'
import { ProjectSectionActions, ProjectSectionFrame } from '@/components/shell/project-section-frame'
import { DocumentActionsTrigger, DocumentObjectMenu } from '@/features/documents/components/document-actions'
import { FileBrowserPane } from '@/features/documents/components/file-browser-pane'
import { FileFilterMenu } from '@/features/documents/components/file-filter-menu'
import { FilesHeaderControls } from '@/features/documents/components/files-header-controls'
import { FolderBrief } from '@/features/documents/components/folder-brief'
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
import { FILES, FOLDERS, useFixtureFolderNav } from '../file-browser/fixtures'

function FilesPage(): JSX.Element {
  const phone = usePhoneLayout()
  const [view, setView] = useState<FileView>('cards')
  const [filters, setFilters] = useState<FileFilters>(NO_FILE_FILTERS)
  const [sort, setSort] = useState<FileSort>(DEFAULT_FILE_SORT)
  const [selected, setSelected] = useState<string | null>(null)
  const [briefCollapsed, setBriefCollapsed] = useState(true)
  const folderNav = useFixtureFolderNav()
  const search = useFileSearch(projectSearchScope('proj-demo'))
  const levelFiles = FILES.filter((file) => (file.folderId ?? null) === folderNav.currentFolderId)
  const currentFolderName = FOLDERS.find((folder) => folder.id === folderNav.currentFolderId)?.name ?? null

  // The waiting count the rail would have read, for the E-Mail-Eingang tab.
  primeInboundMailWaiting('dev', { count: 3, more: false })
  return (
    <div className="relative h-dvh">
      <ProjectSectionFrame projectId="dev" projectName="Wohnhaus Lindengasse" pathname="/app/projects/dev/files" inboundMail>
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
            // A phone's root, as the workspace builds it: the level's tools first in the ⋯.
            levelEntries={
              phone && folderNav.currentFolderId === null
                ? [
                    { type: 'item', id: 'select', label: 'Auswählen', icon: CheckSquare, onSelect: () => {} },
                    { type: 'item', id: 'new-folder', label: 'Ordner anlegen', icon: FolderPlus, onSelect: () => {} },
                  ]
                : undefined
            }
          />
        </ProjectSectionActions>
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
          // „Auswählen“ in the path row, as a project with files offers it.
          selection={{ active: false, selectedIds: new Set(), onToggle: () => {}, onStart: () => {} }}
          rootToolsInMenu={phone && folderNav.currentFolderId === null}
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
            <DocumentObjectMenu document={file} scope="files" folders={FOLDERS} onOpen={() => setSelected(file.id)}>
              {card}
            </DocumentObjectMenu>
          )}
          renderActions={() => <DocumentActionsTrigger />}
        />
        {/* The workspace ends a phone's list above the floating Hochladen (`pb-24`): the last tiles are never under it. */}
        {phone && <div className="h-24" aria-hidden />}
      </ProjectSectionFrame>
      {/* The phone's Hochladen, floating at the foot as the workspace draws it (`uploadFab`). */}
      {phone && (
        <UploadFab inSheet={false}>
          <ProjectUppyUpload onUpload={() => {}} isUploading={false} allowFolders glyphOnly onSendByMail={() => {}} />
        </UploadFab>
      )}
    </div>
  )
}

export default function FilesPageDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  // German, pinned: the copy a person reads, and the widest.
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <FilesPage />
    </I18nProvider>
  )
}
