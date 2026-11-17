'use client'

/**
 * PROTOTYPE, not for merge: three ways a person's own files could work (concept for ticket 81), drawn with the
 * Dateien page's real parts. `?v=page` is a Dateien page of the person's own under „Mein Bereich“, `?v=chat` has no
 * page and works from the chat, `?v=office` is a folder of the person's own inside the Büroablage, and `?v=switch` is
 * one Dateien page with a switch between the project's files and the person's own (`&shelf=own`). `?v=all` is the
 * same rail and switch with „Alle Projekte“ chosen at the top (`&page=files|automation`, `&shelf=own`).
 */

import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, ChevronDown, FileText, Folder, FolderInput, LayoutGrid, LockKeyhole, Paperclip, Plus, Upload, Zap } from 'lucide-react'

import { ProjectSectionActions, ProjectSectionFrame } from '@/components/shell/project-section-frame'
import { ProjectSwitcher } from '@/components/shell/project-switcher'
import { SidebarBrand } from '@/components/shell/sidebar-brand'
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarProvider, SidebarRail } from '@/components/ui/sidebar'
import { FileBrowserPane } from '@/features/documents/components/file-browser-pane'
import { FileFilterMenu } from '@/features/documents/components/file-filter-menu'
import { FilesHeaderControls } from '@/features/documents/components/files-header-controls'
import type { FileItem, FolderItem } from '@/features/documents/components/project-file-workspace'
import { ProjectUppyUpload } from '@/features/documents/components/project-uppy-upload'
import { TaskList } from '@/features/tasks/components/task-list'
import type { TaskFilter, TaskRunView } from '@/features/tasks/lib/task-view'
import { useFileSearch } from '@/features/documents/hooks/use-file-search'
import type { FileView } from '@/features/documents/hooks/use-view-preference'
import { NO_FILE_FILTERS } from '@/features/documents/lib/file-filters'
import { projectSearchScope } from '@/features/documents/lib/file-shelf'
import { DEFAULT_FILE_SORT } from '@/features/documents/lib/file-sort'
import { I18nProvider } from '@/i18n'
import { makeFile, useFixtureFolderNav } from '../file-browser/fixtures'
import { REAL_FILES, REAL_FOLDERS } from '../files-page/fixtures'
import { ALL_CHATS, ChatRow, Foot, GroupLabel, MoreRow, NavRow, PROJECTS } from '../personal-area-rail/prototype'

const OWN = { id: 'none', name: 'Alle Projekte' }

const OWN_FOLDERS: FolderItem[] = [
  { id: 'o-templates', parentId: null, name: 'Vorlagen', path: '/Vorlagen' },
  { id: 'o-notes', parentId: null, name: 'Notizen', path: '/Notizen' },
  { id: 'o-training', parentId: null, name: 'Weiterbildung', path: '/Weiterbildung' },
]
const OWN_FILES: FileItem[] = [
  makeFile('o1', 'Leitfaden_Bauherrengespraech.pdf', '', { fileSize: 420_000, createdAt: '2026-11-03T09:00:00Z' }),
  makeFile('o2', 'Checkliste_Einreichung_Wien.pdf', '', { fileSize: 180_000, createdAt: '2026-10-21T09:00:00Z' }),
  makeFile('o3', 'Vorlage_Besprechungsprotokoll.pdf', '', { folderId: 'o-templates' }),
  makeFile('o4', 'Vorlage_Maengelliste.pdf', '', { folderId: 'o-templates' }),
  makeFile('o5', 'Notizen_Jour-fixe.pdf', '', { folderId: 'o-notes' }),
  makeFile('o6', 'Seminar_Holzbau_2026.pdf', '', { folderId: 'o-training' }),
]

const OFFICE_FOLDERS: FolderItem[] = [
  { id: 'f-own', parentId: null, name: 'Meine Dateien (nur Sie)', path: '/Meine Dateien' },
  { id: 'f-plan', parentId: null, name: 'Planung', path: '/Planung' },
  { id: 'f-law', parentId: null, name: 'Baurecht', path: '/Baurecht' },
]
const OFFICE_FILES: FileItem[] = [
  makeFile('f1', 'Referenzprojekt_Stadthaus-Wien.pdf', ''),
  makeFile('f2', 'Statik_Standardpositionen.pdf', ''),
  ...OWN_FILES.map((file) => ({ ...file, id: `own-${file.id}`, folderId: 'f-own' })),
  makeFile('f3', 'Bürostandard_Garagen.pdf', '', { folderId: 'f-plan' }),
  makeFile('f4', 'Bauordnung_Kommentar.pdf', '', { folderId: 'f-law' }),
]

/** The rail the concept settled on for now: the switcher names the project or „Mein Bereich“, the chats are the reader's own. */
function Rail({ own, ownFiles = false, officeShelfOpen = false, openChat = null, projectFilesOpen = false, section }: { own: boolean; ownFiles?: boolean; officeShelfOpen?: boolean; openChat?: number | null; projectFilesOpen?: boolean; section?: 'files' | 'automation' }): JSX.Element {
  return (
    <SidebarProvider className="h-full min-h-0 w-auto shrink-0">
      <Sidebar collapsible="icon" data-scope="project" aria-label="Navigation">
        <SidebarHeader className="shrink-0 gap-0 p-0 px-3">
          <SidebarBrand iconRail={false} />
          <div className="mt-1 flex items-center">
            <ProjectSwitcher projects={[OWN, ...PROJECTS]} activeProjectId={own ? 'none' : 'p-1'} />
          </div>
        </SidebarHeader>
        <SidebarContent className="mt-3 flex-1 gap-0 overflow-y-auto px-3 py-px">
          {section && (
            <SidebarMenu className="mb-6 gap-0.5">
              <NavRow icon={Folder} label="Dateien" active={section === 'files'} />
              <NavRow icon={LayoutGrid} label="Übersicht" />
              <NavRow icon={Zap} label="Automatisierung" active={section === 'automation'} />
            </SidebarMenu>
          )}
          {!section && (ownFiles || !own) && (
            <SidebarMenu className="mb-6 gap-0.5">
              <NavRow icon={Folder} label="Dateien" active={projectFilesOpen || (own && ownFiles && openChat === null && !officeShelfOpen)} />
              {!own && <NavRow icon={LayoutGrid} label="Übersicht" />}
              {!own && <NavRow icon={Zap} label="Automatisierung" />}
            </SidebarMenu>
          )}
          <a href="#" className="bg-sheet shadow-press flex h-9 shrink-0 items-center justify-center gap-2 rounded-control text-sm font-medium">
            <Plus className="size-4" aria-hidden />
            Neuer Chat
          </a>
          <GroupLabel>Chats</GroupLabel>
          <ul className="flex flex-col gap-0.5">
            {ALL_CHATS.map((chat, index) => (
              <ChatRow key={chat.title} chat={chat} current={index === openChat} showProject indent={false} />
            ))}
            <MoreRow label="Alle Chats" indent={false} />
          </ul>
        </SidebarContent>
        <Foot officeShelfOpen={officeShelfOpen} />
        <SidebarRail aria-label="Breite ändern" />
      </Sidebar>
    </SidebarProvider>
  )
}

function Browser({ files, folders }: { files: FileItem[]; folders: FolderItem[] }): JSX.Element {
  const [view, setView] = useState<FileView>('cards')
  const [selected, setSelected] = useState<string | null>(null)
  const folderNav = useFixtureFolderNav(folders, null)
  const search = useFileSearch(projectSearchScope('proj-demo'))
  const level = files.filter((file) => (file.folderId ?? null) === folderNav.currentFolderId)
  return (
    <FileBrowserPane
      files={level}
      searchFiles={files}
      uploadControl={<ProjectUppyUpload onUpload={() => {}} isUploading={false} allowFolders />}
      selectedFileId={selected}
      onSelectFile={setSelected}
      isLoading={false}
      search={search}
      view={view}
      onViewChange={setView}
      folderNav={folderNav}
      selection={{ active: false, selectedIds: new Set(), onToggle: () => {}, onStart: () => {} }}
    />
  )
}

/** Who reads this place: the same pill the chat carries. */
function OnlyYou(): JSX.Element {
  return (
    <span className="bg-sheet shadow-press text-name inline-flex h-7 items-center gap-1.5 rounded-full px-2.5">
      <LockKeyhole className="size-3.5" aria-hidden />
      Nur Sie
    </span>
  )
}

/** The page-level switch: the scope the top names, or the person's own. */
function OwnSwitch({ scope, own, ownLabel }: { scope: string; own: boolean; ownLabel: string }): JSX.Element {
  const on = 'bg-sheet shadow-xs rounded-[4px] px-3 py-1.5'
  const off = 'text-muted-foreground px-3 py-1.5'
  return (
    <div className="flex items-center gap-3">
      {own && <OnlyYou />}
      <div className="bg-desk text-name flex rounded-control p-0.5 font-medium">
        <span className={own ? off : on}>{scope}</span>
        <span className={own ? on : off}>{ownLabel}</span>
      </div>
    </div>
  )
}

const PROJECT_FOLDERS: FolderItem[] = PROJECTS.map((project) => ({ id: project.id, parentId: null, name: project.name, path: `/${project.name}` }))
const PROJECT_FOLDER_FILES: FileItem[] = PROJECTS.flatMap((project, index) => Array.from({ length: [286, 112, 64, 31][index] ?? 12 }, (_, n) => makeFile(`${project.id}-${n}`, `Datei_${n}.pdf`, '', { folderId: project.id })))

const run = (overrides: Partial<TaskRunView>): TaskRunView => ({
  id: 'task-0',
  kind: 'document',
  title: '',
  goal: null,
  status: 'succeeded',
  review: null,
  reviewReason: null,
  filedDocumentId: null,
  conversationId: null,
  runMessageId: null,
  taskId: null,
  trigger: 'schedule',
  requesterUserId: 'user_anna',
  requesterName: 'Anna Berger',
  createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  finishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  error: null,
  ...overrides,
})
const ALL_RUNS: TaskRunView[] = [
  run({ id: 'a1', kind: 'deep-research', title: 'Seestadt D12 · Wöchentlicher Brandschutz-Abgleich', status: 'running', runSummary: { status: 'running', rounds: 2, docs: 7 } }),
  run({ id: 'a2', title: 'Amtshaus Favoriten · Planstand der Statik prüfen', requesterName: 'Maria Huber' }),
  run({ id: 'a3', title: 'Lände 3 · Jour fixe vorbereiten', requesterName: 'Jonas Weber', createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() }),
]
const OWN_RUNS: TaskRunView[] = [
  run({ id: 'o1', title: 'Agenda vor jedem Jour fixe vorbereiten' }),
  run({ id: 'o2', kind: 'deep-research', title: 'Montags: neue Fassungen der Richtlinien zusammenfassen', createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString() }),
]

/** E: „Alle Projekte“ at the top keeps the sections; each page switches between every project's and the person's own. */
function AllProjects({ page, own }: { page: 'files' | 'automation'; own: boolean }): JSX.Element {
  const [filter, setFilter] = useState<TaskFilter>('all')
  return (
    <>
      <Rail own section={page} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-end justify-between gap-4 px-8 pb-4 pt-6">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-meta">{own ? 'Nur für Sie' : 'Alle Projekte'}</span>
            <h1 className="text-page-title">{page === 'files' ? 'Dateien' : 'Automatisierung'}</h1>
          </div>
          <OwnSwitch scope="Alle Projekte" own={own} ownLabel={page === 'files' ? 'Meine Dateien' : 'Meine'} />
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {page === 'files' ? (
            own ? <Browser key="own" files={OWN_FILES} folders={OWN_FOLDERS} /> : <Browser key="all" files={PROJECT_FOLDER_FILES} folders={PROJECT_FOLDERS} />
          ) : (
            <div className="px-8">
              <TaskList projectId="preview" tasks={own ? OWN_RUNS : ALL_RUNS} filter={filter} onFilterChange={setFilter} onSelectTask={() => {}} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/** Files of the person's own that belong to the project, as a chat of theirs can: only they see them. */
const OWN_PROJECT_FILES: FileItem[] = [
  makeFile('op1', 'Notizen_Bauherrengespraech_03-11.pdf', '', { fileSize: 90_000, createdAt: '2026-11-03T09:00:00Z' }),
  makeFile('op2', 'Honorarueberlegung_Entwurf.pdf', '', { fileSize: 140_000, createdAt: '2026-11-10T09:00:00Z' }),
]

/**
 * D: one Dateien page. The track beside the tools says whose files these are: a project's (its name opens the list
 * of projects) or the person's own. `top` is what the rail's switcher shows, `menu` opens the list of projects.
 */
function SwitchPage({ own, top, menu, scoped }: { own: boolean; top: 'project' | 'all'; menu: boolean; scoped: boolean }): JSX.Element {
  const [view, setView] = useState<FileView>('cards')
  const search = useFileSearch(projectSearchScope('proj-demo'))
  const project = PROJECTS[0]!
  const on = 'bg-sheet shadow-xs rounded-[4px] px-3 py-1.5'
  const off = 'text-muted-foreground px-3 py-1.5'
  return (
    <>
      <Rail own={top === 'all'} section="files" />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {own && (
          <div className="absolute left-[132px] top-[38px] z-10">
            <OnlyYou />
          </div>
        )}
        {/* One chooser for the project (the rail's switcher). `menu` keeps the earlier draft, where the track chose it too. */}
        {menu ? (
          <div className="absolute right-8 top-8 z-10">
            <div className="bg-desk text-name flex rounded-control p-0.5 font-medium">
              <span className={`${own ? off : on} inline-flex items-center gap-1`}>
                {top === 'all' ? 'Projekt wählen' : project.short}
                <ChevronDown className="size-3.5" aria-hidden />
              </span>
              <span className={own ? on : off}>Meine Dateien</span>
            </div>
            <div className="bg-sheet shadow-md absolute right-0 top-full mt-2 w-72 rounded-[16px] p-1.5">
              <div className="text-muted-foreground text-meta px-2.5 pb-1 pt-1.5 font-medium">Dateien eines Projekts</div>
              {PROJECTS.map((item) => (
                <div key={item.id} className="text-name flex h-9 items-center gap-2.5 rounded-control px-2.5">
                  <Folder className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        ) : top === 'project' ? (
          <div className="bg-desk text-name absolute right-8 top-8 z-10 flex rounded-control p-0.5 font-medium">
            <span className={own ? off : on}>Projektdateien</span>
            <span className={own ? on : off}>Meine Dateien</span>
          </div>
        ) : (
          <p className="text-muted-foreground absolute right-8 top-10 z-10 text-sm">Für Projektdateien oben ein Projekt wählen.</p>
        )}
        <ProjectSectionFrame projectId="dev" projectName={own ? (top === 'all' ? 'Alle Projekte' : project.name) : project.name} pathname="/app/projects/dev/files" inboundMail={!own}>
          <ProjectSectionActions>
            <FilesHeaderControls
              phone={false}
              view={view}
              onViewChange={setView}
              renderFilter={(compact) => <FileFilterMenu canCollaborate filters={NO_FILE_FILTERS} onFiltersChange={() => {}} sort={DEFAULT_FILE_SORT} onSortChange={() => {}} compact={compact} />}
              search={{ value: search.query, onChange: search.setQuery, onSubmit: search.run, onClear: search.clear }}
              upload={<ProjectUppyUpload onUpload={() => {}} isUploading={false} allowFolders />}
            />
          </ProjectSectionActions>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {own && top === 'project' && (
              <div className="text-name flex items-center gap-1.5 px-8 pb-2 pt-1">
                <span className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 ${scoped ? 'bg-selected' : 'bg-desk'}`}>
                  {scoped && <Check className="size-3.5" aria-hidden />}
                  Zu {project.short}
                </span>
                <span className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 ${scoped ? 'bg-desk' : 'bg-selected'}`}>
                  {!scoped && <Check className="size-3.5" aria-hidden />}
                  Alle meine Dateien
                </span>
              </div>
            )}
            {own ? (
              scoped && top === 'project' ? (
                <Browser key="own-project" files={OWN_PROJECT_FILES} folders={[]} />
              ) : (
                <Browser key="own" files={OWN_FILES} folders={OWN_FOLDERS} />
              )
            ) : (
              <Browser key="project" files={REAL_FILES} folders={REAL_FOLDERS} />
            )}
          </div>
        </ProjectSectionFrame>
      </div>
    </>
  )
}

/** A: a Dateien page of the person's own, the project's page with another owner. */
function OwnPage(): JSX.Element {
  const [view, setView] = useState<FileView>('cards')
  const search = useFileSearch(projectSearchScope('proj-demo'))
  return (
    <>
      <Rail own ownFiles />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="absolute right-8 top-9 z-10">
          <OnlyYou />
        </div>
        <ProjectSectionFrame projectId="dev" projectName="Mein Bereich" pathname="/app/projects/dev/files">
          <ProjectSectionActions>
            <FilesHeaderControls
              phone={false}
              view={view}
              onViewChange={setView}
              renderFilter={(compact) => <FileFilterMenu canCollaborate filters={NO_FILE_FILTERS} onFiltersChange={() => {}} sort={DEFAULT_FILE_SORT} onSortChange={() => {}} compact={compact} />}
              search={{ value: search.query, onChange: search.setQuery, onSubmit: search.run, onClear: search.clear }}
              upload={<ProjectUppyUpload onUpload={() => {}} isUploading={false} allowFolders />}
            />
          </ProjectSectionActions>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <Browser files={OWN_FILES} folders={OWN_FOLDERS} />
          </div>
        </ProjectSectionFrame>
      </div>
    </>
  )
}

function MenuRow({ icon: Icon, children, picked = false }: { icon: typeof Upload; children: ReactNode; picked?: boolean }): JSX.Element {
  return (
    <div className={`text-name flex h-9 items-center gap-2.5 rounded-control px-2.5 ${picked ? 'bg-desk' : ''}`}>
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  )
}

/** B: no page. A file in a chat is kept with one press, and the composer's paperclip offers what was kept. */
function FromChat(): JSX.Element {
  return (
    <>
      <Rail own openChat={0} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-col gap-1 px-8 pb-4 pt-6">
          <span className="text-muted-foreground text-meta">Mein Bereich</span>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-pane-title">Rampenneigung Tiefgarage</h1>
            <OnlyYou />
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-8">
          <div className="bg-desk text-name self-end rounded-[16px] px-3 py-2">Prüf das bitte gegen meinen Leitfaden.</div>
          <div className="bg-sheet shadow-sm flex items-center gap-3 self-end rounded-[10px] px-3 py-2">
            <FileText className="text-muted-foreground size-4" aria-hidden />
            <span className="text-name">Leitfaden_Garagen.pdf</span>
            <span className="shadow-press text-name inline-flex h-7 items-center gap-1.5 rounded-control px-2.5">
              <FolderInput className="size-3.5" aria-hidden />
              In meine Dateien
            </span>
          </div>
        </div>
        <div className="relative mx-auto mb-8 w-full max-w-2xl px-8">
          <div className="absolute bottom-full left-8 mb-2 flex items-end gap-2">
            <div className="bg-sheet shadow-md w-60 rounded-[16px] p-1.5">
              <MenuRow icon={Upload}>Vom Computer hochladen</MenuRow>
              <MenuRow icon={Folder} picked>
                Aus meinen Dateien
              </MenuRow>
              <MenuRow icon={Folder}>Aus einem Projekt</MenuRow>
            </div>
            <div className="bg-sheet shadow-md w-72 rounded-[16px] p-1.5">
              <div className="text-muted-foreground text-meta px-2.5 pb-1 pt-1.5 font-medium">Meine Dateien</div>
              {OWN_FILES.slice(0, 4).map((file, index) => (
                <div key={file.id} className="text-name flex h-9 items-center gap-2.5 rounded-control px-2.5">
                  <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                  {index === 0 && <Check className="size-4 shrink-0" aria-hidden />}
                </div>
              ))}
              <div className="text-muted-foreground text-name flex h-9 items-center px-2.5">Alle verwalten …</div>
            </div>
          </div>
          <div className="bg-sheet border-field-border flex flex-col gap-3 rounded-[10px] border p-3">
            <span className="text-muted-foreground text-sm">Frage stellen …</span>
            <div className="text-name flex flex-wrap items-center gap-1.5">
              <span className="bg-desk inline-flex size-7 items-center justify-center rounded-control">
                <Paperclip className="size-4" aria-hidden />
              </span>
              <span className="text-muted-foreground text-meta mx-1">Grundlage</span>
              {['Wissen', 'Büroablage'].map((label) => (
                <span key={label} className="bg-desk inline-flex h-7 items-center rounded-full px-2.5">
                  {label}
                </span>
              ))}
              <span className="shadow-press inline-flex h-7 items-center rounded-full px-2.5">+ Projekt</span>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}

/** C: no new place. The Büroablage holds one folder per person that only that person can open. */
function InOfficeShelf(): JSX.Element {
  return (
    <>
      <Rail own={false} officeShelfOpen />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-col gap-1 px-8 pb-2 pt-6">
          <h1 className="text-page-title">Büroablage</h1>
          <p className="text-muted-foreground text-sm">Gemeinsame Dokumente, die jedem Projekt Ihrer Organisation zur Verfügung stehen</p>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Browser files={OFFICE_FILES} folders={OFFICE_FOLDERS} />
        </div>
      </div>
    </>
  )
}

export default function PersonalFilesPreview(): JSX.Element {
  const params = useSearchParams()
  const variant = params?.get('v') ?? 'page'
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <div className="bg-background text-foreground flex h-dvh overflow-hidden">{variant === 'all' ? <AllProjects page={params?.get('page') === 'automation' ? 'automation' : 'files'} own={params?.get('shelf') === 'own'} /> : variant === 'switch' ? <SwitchPage own={params?.get('shelf') === 'own'} top={params?.get('top') === 'all' ? 'all' : 'project'} menu={params?.get('menu') === '1'} scoped={params?.get('mine') !== 'all'} /> : variant === 'office' ? <InOfficeShelf /> : variant === 'chat' ? <FromChat /> : <OwnPage />}</div>
    </I18nProvider>
  )
}
