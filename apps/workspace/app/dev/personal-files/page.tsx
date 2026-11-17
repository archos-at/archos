'use client'

// PROTOTYPE, not for merge: the person's own Ablage beside the project's, and the chat beside the rail (concept for ticket 81).

import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, ChevronDown, FileText, FolderLock, Settings, Folder, FolderInput, LayoutGrid, LockKeyhole, Paperclip, Plus, Upload, Zap } from 'lucide-react'

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
import { ALL_CHATS, ChatRow, Foot, GroupLabel, MoreRow, NavRow, Page, PROJECTS } from '../personal-area-rail/prototype'

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

function Rail({ own, ownFiles = false, officeShelfOpen = false, openChat = null, projectFilesOpen = false, section, shelfRows, ownShelf, gear = false }: { own: boolean; ownFiles?: boolean; officeShelfOpen?: boolean; openChat?: number | null; projectFilesOpen?: boolean; section?: 'files' | 'automation'; shelfRows?: 'project' | 'own'; ownShelf?: 'idle' | 'open'; gear?: boolean | 'menu' | 'none' }): JSX.Element {
  return (
    <SidebarProvider className="h-full min-h-0 w-auto shrink-0">
      <Sidebar collapsible="icon" data-scope="project" aria-label="Navigation">
        <SidebarHeader className="shrink-0 gap-0 p-0 px-3">
          <SidebarBrand iconRail={false} />
          <div className="relative mt-1 flex items-center gap-1.5">
            <ProjectSwitcher projects={[OWN, ...PROJECTS]} activeProjectId={own ? 'none' : 'p-1'} />
            {gear === 'menu' && (
              <div className="bg-sheet shadow-md absolute left-0 right-0 top-full z-50 mt-1.5 rounded-[16px] p-1.5">
                <div className="text-name flex h-9 items-center gap-2.5 rounded-control px-2.5 font-medium">
                  <Settings className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  Projekteinstellungen
                </div>
                <div className="bg-desk mx-1 my-1.5 h-px" />
                <div className="text-muted-foreground text-meta px-2.5 pb-1 pt-1 font-medium">Projekt wechseln</div>
                {[OWN, ...PROJECTS].map((item) => (
                  <div key={item.id} className={`text-name flex h-9 items-center gap-2.5 rounded-control px-2.5 ${item.id === 'p-1' ? 'bg-desk' : ''}`}>
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {item.id === 'p-1' && <Check className="size-4 shrink-0" aria-hidden />}
                  </div>
                ))}
              </div>
            )}
            {gear === true && !own && (
              <span title="Projekteinstellungen" className="bg-sheet shadow-press text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-control">
                <Settings className="size-4" aria-hidden />
              </span>
            )}
          </div>
        </SidebarHeader>
        <SidebarContent className="mt-3 flex-1 gap-0 overflow-y-auto px-3 py-px">
          <SidebarMenu className="mb-6 gap-0.5">
            <NavRow icon={Folder} label="Ablage" within={Boolean(shelfRows)} active={!shelfRows && ownShelf !== 'open' && (section === 'files' || projectFilesOpen || (ownFiles && openChat === null && !officeShelfOpen))} />
            {shelfRows && (
              <ul className="flex flex-col gap-0.5 pt-0.5">
                {!own && <ChatRow chat={{ title: 'Projektablage' }} current={shelfRows === 'project'} />}
                <ChatRow chat={{ title: 'Meine Ablage' }} current={shelfRows === 'own'} />
              </ul>
            )}
            {!gear && <NavRow icon={LayoutGrid} label="Übersicht" />}
            <NavRow icon={Zap} label="Automatisierung" active={section === 'automation'} />
          </SidebarMenu>
          <a href="#" className="bg-sheet shadow-press flex h-9 shrink-0 items-center justify-center gap-2 rounded-control text-[13px] font-medium">
            <Plus className="size-4" aria-hidden />
            Neuer Chat
          </a>
          <div className="text-muted-foreground text-meta mt-5 flex h-7 items-center gap-1 px-3 font-medium">
            Letzte Chats
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
          </div>
          <ul className="flex flex-col gap-0.5">
            {ALL_CHATS.map((chat, index) => (
              <ChatRow key={chat.title} chat={chat} current={index === openChat} showProject indent={false} />
            ))}
            <MoreRow label="Alle Chats" indent={false} />
          </ul>
        </SidebarContent>
        <Foot officeShelfOpen={officeShelfOpen} ownShelf={ownShelf} />
        <SidebarRail aria-label="Breite ändern" />
      </Sidebar>
    </SidebarProvider>
  )
}

function Browser({ files, folders, openFolder = null }: { files: FileItem[]; folders: FolderItem[]; openFolder?: string | null }): JSX.Element {
  const [view, setView] = useState<FileView>('cards')
  const [selected, setSelected] = useState<string | null>(null)
  const folderNav = useFixtureFolderNav(folders, openFolder)
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

function OnlyYou(): JSX.Element {
  return (
    <span className="bg-sheet shadow-press text-name inline-flex h-7 items-center gap-1.5 rounded-full px-2.5">
      <LockKeyhole className="size-3.5" aria-hidden />
      Nur Sie
    </span>
  )
}

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

function SwitchPage({ own, top, titleSwitch, mode, menuOpen, settingsOpen }: { own: boolean; top: 'project' | 'all'; titleSwitch: boolean; mode: string; menuOpen: boolean; settingsOpen: boolean }): JSX.Element {
  const [view, setView] = useState<FileView>('cards')
  const search = useFileSearch(projectSearchScope('proj-demo'))
  const project = PROJECTS[0]!
  const on = 'bg-sheet shadow-xs rounded-[4px] px-3 py-1.5'
  const off = 'text-muted-foreground px-3 py-1.5'
  const tall = mode === 'cards' || mode === 'wide'
  const sides = [
    { label: 'Projektablage', hint: top === 'project' ? `${project.short} · für das Team` : 'Kein Projekt ausgewählt', icon: Folder, picked: !own, off: top === 'all' },
    { label: 'Meine Ablage', hint: 'Nur für Sie', icon: FolderLock, picked: own, off: false },
  ]
  return (
    <>
      <Rail own={top === 'all'} section="files" gear={mode === 'cards' || mode === 'wide' ? (settingsOpen ? 'menu' : 'none') : mode !== 'track'} shelfRows={mode === 'rail' ? (own ? 'own' : 'project') : undefined} ownShelf={mode === 'foot' ? (own ? 'open' : 'idle') : undefined} />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className={`bg-background absolute left-8 right-8 top-[10px] z-40 flex flex-col justify-between ${tall ? 'h-[126px] justify-start gap-1' : 'h-[68px]'}`}>
          <span className="text-muted-foreground text-meta flex items-center gap-1.5">{own ? 'Projektunabhängig' : project.name}</span>
          {tall && <h1 className="text-page-title -mt-1">Ablage</h1>}
          {mode === 'wide' && (
            <div className="bg-desk mt-4 grid max-w-[620px] grid-cols-2 rounded-[10px] p-1">
              {sides.map((side) => (
                <div key={side.label} className={`flex h-11 items-center gap-2.5 px-4 ${side.picked ? 'bg-sheet shadow-xs rounded-[8px]' : ''}`}>
                  <side.icon className={`size-4 shrink-0 ${side.picked ? '' : 'text-muted-foreground'}`} aria-hidden />
                  <span className={`text-sm ${side.picked ? 'font-medium' : 'text-muted-foreground font-normal'}`}>{side.label}</span>
                  <span className="text-muted-foreground text-meta ml-auto shrink-0">{side.off ? 'Kein Projekt' : side.icon === FolderLock ? 'Nur Sie' : 'Team'}</span>
                </div>
              ))}
            </div>
          )}
          {mode === 'cards' && (
            <div className="grid max-w-[620px] grid-cols-2 gap-3">
              {sides.map((side) => (
                <div key={side.label} className={`flex h-[60px] items-center gap-3 rounded-[10px] px-4 ${side.picked ? 'bg-sheet ring-foreground shadow-sm ring-[1.5px]' : 'shadow-press'}`}>
                  <side.icon className={`size-5 shrink-0 ${side.picked ? '' : 'text-muted-foreground'}`} aria-hidden />
                  <div className="min-w-0">
                    <div className={`text-[15px] leading-5 ${side.picked ? 'font-semibold' : 'font-medium'} ${side.off ? 'text-muted-foreground' : ''}`}>{side.label}</div>
                    <div className="text-muted-foreground text-meta truncate">{side.hint}</div>
                  </div>
                  {side.picked && <Check className="ml-auto size-4 shrink-0" aria-hidden />}
                </div>
              ))}
            </div>
          )}
          <div className={tall ? 'hidden' : 'flex h-11 items-center gap-4'}>
          {mode === 'rail' || mode === 'foot' ? (
            <h1 className="text-page-title">{own ? 'Meine Ablage' : mode === 'foot' ? 'Ablage' : 'Projektablage'}</h1>
          ) : mode === 'menu' ? (
            <div className="relative">
              <h1 className="text-page-title hover:bg-desk -ml-2 inline-flex items-center gap-2 rounded-control px-2 py-1">
                {own ? 'Meine Ablage' : 'Projektablage'}
                <ChevronDown className="text-muted-foreground size-5" aria-hidden />
              </h1>
              {menuOpen && (
                <div className="bg-sheet shadow-md absolute left-0 top-full z-20 mt-2 w-72 rounded-[16px] p-1.5">
                  {[
                    { label: 'Projektablage', hint: project.short, on: !own },
                    { label: 'Meine Ablage', hint: 'Nur Sie', on: own },
                  ].map((item) => (
                    <div key={item.label} className={`text-name flex h-10 items-center gap-2.5 rounded-control px-2.5 ${item.on ? 'bg-desk' : ''}`}>
                      <Folder className="text-muted-foreground size-4 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                      <span className="text-muted-foreground text-meta">{item.hint}</span>
                      {item.on && <Check className="size-4 shrink-0" aria-hidden />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : titleSwitch ? (
            <div className="bg-desk flex rounded-[8px] p-1 text-[17px] leading-6 font-semibold">
              <span className={own ? 'text-muted-foreground px-4 py-1.5 font-medium' : 'bg-sheet shadow-xs rounded-control px-4 py-1.5'}>{top === 'project' ? 'Projektablage' : 'Kein Projekt ausgewählt'}</span>
              <span className={own ? 'bg-sheet shadow-xs rounded-control px-4 py-1.5' : 'text-muted-foreground px-4 py-1.5 font-medium'}>Meine Ablage</span>
            </div>
          ) : (
            <>
              <h1 className="text-page-title">Ablage</h1>
              <div className="bg-desk text-name flex rounded-control p-0.5 font-medium">
                <span className={own ? off : on}>{top === 'project' ? 'Projektablage' : 'Kein Projekt ausgewählt'}</span>
                <span className={own ? on : off}>Meine Ablage</span>
              </div>
            </>
          )}
          </div>
        </div>
        <div className={tall ? 'flex min-h-0 flex-1 flex-col pt-[58px]' : 'contents'}>
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
            {own ? (
              <Browser key="own" files={OWN_FILES} folders={OWN_FOLDERS} />
            ) : (
              <Browser key="project" files={REAL_FILES} folders={REAL_FOLDERS} />
            )}
          </div>
        </ProjectSectionFrame>
        </div>
      </div>
    </>
  )
}

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

function FromChat(): JSX.Element {
  return (
    <>
      <Rail own openChat={0} gear="none" />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-col gap-1 px-8 pb-4 pt-6">
          <span className="text-muted-foreground text-meta">Projektübergreifend</span>
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
              In meine Ablage
            </span>
          </div>
        </div>
        <div className="relative mx-auto mb-8 w-full max-w-2xl px-8">
          <div className="absolute bottom-full left-8 mb-2 flex items-end gap-2">
            <div className="bg-sheet shadow-md w-60 rounded-[16px] p-1.5">
              <MenuRow icon={Upload}>Vom Computer hochladen</MenuRow>
              <MenuRow icon={FolderLock} picked>
                Aus meiner Ablage
              </MenuRow>
            </div>
            <div className="bg-sheet shadow-md w-72 rounded-[16px] p-1.5">
              <div className="text-muted-foreground text-meta px-2.5 pb-1 pt-1.5 font-medium">Meine Ablage</div>
              {OWN_FILES.slice(0, 4).map((file, index) => (
                <div key={file.id} className="text-name flex h-9 items-center gap-2.5 rounded-control px-2.5">
                  <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                  {index === 0 && <Check className="size-4 shrink-0" aria-hidden />}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-sheet border-field-border flex items-center gap-3 rounded-[10px] border p-3">
            <span className="bg-desk inline-flex size-7 shrink-0 items-center justify-center rounded-control">
              <Paperclip className="size-4" aria-hidden />
            </span>
            <span className="text-muted-foreground text-sm">Frage stellen …</span>
          </div>
        </div>
      </main>
    </>
  )
}

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

function Talk({ place, settingsOpen }: { place: string; settingsOpen: boolean }): JSX.Element {
  const own = place === 'me'
  return (
    <>
      <Rail own={own} openChat={own ? 0 : place === 'project' ? 1 : null} gear={settingsOpen ? 'menu' : 'none'} />
      <Page me={own} fresh={place === 'new'} noneLabel="Alle Projekte" />
    </>
  )
}

export default function PersonalFilesPreview(): JSX.Element {
  const params = useSearchParams()
  const variant = params?.get('v') ?? 'page'
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <div className="bg-background text-foreground flex h-dvh overflow-hidden">{variant === 'talk' ? <Talk place={params?.get('place') ?? 'me'} settingsOpen={params?.get('settings') === '1'} /> : variant === 'all' ? <AllProjects page={params?.get('page') === 'automation' ? 'automation' : 'files'} own={params?.get('shelf') === 'own'} /> : variant === 'switch' ? <SwitchPage own={params?.get('shelf') === 'own'} top={params?.get('top') === 'all' ? 'all' : 'project'} mode={params?.get('mode') ?? 'track'} menuOpen={params?.get('open') === '1'} settingsOpen={params?.get('settings') === '1'} titleSwitch={params?.get('pos') === 'title'} /> : variant === 'office' ? <InOfficeShelf /> : variant === 'chat' ? <FromChat /> : <OwnPage />}</div>
    </I18nProvider>
  )
}
