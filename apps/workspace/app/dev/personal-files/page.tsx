'use client'

// PROTOTYPE, not for merge: the person's own Ablage beside the project's, and the chat beside the rail (concept for ticket 81).

import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Bell, Check, ChevronDown, FileText, FolderLock, Settings, Folder, FolderInput, LayoutGrid, LockKeyhole, Paperclip, Upload, Zap } from 'lucide-react'

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
import { InboxAll, InboxPanel } from './inbox-panel'
import { AcrossTrigger, ProjectMenu, ProjectOverview } from './project-menu'
import { FolderPath, ReadStatus, ShelfHeader, TrashWindow, UnreadHint } from './shelf-header'
import { REAL_FILES, REAL_FOLDERS } from '../files-page/fixtures'
import { ALL_CHATS, ChatHeader, ChatRow, Foot, MoreRow, NavRow, NewChatButton, NewChatPage, Page, PROJECTS } from '../personal-area-rail/prototype'

const OWN = { id: 'none', name: 'Alle Projekte' }
const OWN_ACROSS = { id: 'none', name: 'Projektübergreifend' }

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

function Rail({ own, ownFiles = false, officeShelfOpen = false, openChat = null, projectFilesOpen = false, section, shelfRows, ownShelf, gear = false, rowMenu, menuForm = 'gear', shelfCount = 0, inbox = 'bell', inboxOpen = false, officeName }: { own: boolean; ownFiles?: boolean; officeShelfOpen?: boolean; openChat?: number | null; projectFilesOpen?: boolean; section?: 'files' | 'automation'; shelfRows?: 'project' | 'own'; ownShelf?: 'idle' | 'open'; gear?: boolean | 'menu' | 'none'; rowMenu?: number; menuForm?: string; shelfCount?: number; inbox?: string; inboxOpen?: boolean; officeName?: string }): JSX.Element {
  return (
    <SidebarProvider className="h-full min-h-0 w-auto shrink-0">
      <Sidebar collapsible="icon" data-scope="project" aria-label="Navigation">
        <SidebarHeader className="shrink-0 gap-0 p-0 px-3">
          <SidebarBrand iconRail={false} />
          <div className="relative mt-1 flex items-center gap-1.5">
            {own && menuForm === 'gear' ? <AcrossTrigger /> : <ProjectSwitcher projects={[menuForm === 'top' ? OWN : OWN_ACROSS, ...PROJECTS]} activeProjectId={own ? 'none' : 'p-1'} />}
            {gear === 'menu' && <ProjectMenu form={menuForm} across={own} />}
            {gear === true && !own && (
              <span title="Projekteinstellungen" className="bg-sheet shadow-press text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-control">
                <Settings className="size-4" aria-hidden />
              </span>
            )}
          </div>
        </SidebarHeader>
        <SidebarContent className="mt-3 flex-1 gap-0 overflow-y-auto px-3 py-px">
          <SidebarMenu className="mb-6 gap-0.5">
            <NavRow icon={Folder} label="Ablage" badge={shelfCount} within={Boolean(shelfRows)} active={!shelfRows && ownShelf !== 'open' && (section === 'files' || projectFilesOpen || (ownFiles && openChat === null && !officeShelfOpen))} />
            {shelfRows && (
              <ul className="flex flex-col gap-0.5 pt-0.5">
                {!own && <ChatRow chat={{ title: 'Projektablage' }} current={shelfRows === 'project'} />}
                <ChatRow chat={{ title: 'Meine Ablage' }} current={shelfRows === 'own'} />
              </ul>
            )}
            {!gear && <NavRow icon={LayoutGrid} label="Übersicht" />}
            <NavRow icon={Zap} label="Automatisierung" active={section === 'automation'} />
          </SidebarMenu>
          <NewChatButton />
          {inbox === 'top' && (
            <SidebarMenu className="mt-1 gap-0.5">
              <NavRow icon={Bell} label="Postfach" badge={8} active={inboxOpen} />
            </SidebarMenu>
          )}
          <div className="text-muted-foreground text-meta mt-5 flex h-7 items-center gap-1 px-3 font-medium">
            Letzte Chats
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
          </div>
          <ul className="flex flex-col gap-0.5">
            {ALL_CHATS.map((chat, index) => (
              <ChatRow key={chat.title} chat={chat} current={index === openChat} showProject indent={false} hovered={index === rowMenu} menuOpen={index === rowMenu} />
            ))}
            <MoreRow label="Alle Chats" indent={false} />
          </ul>
        </SidebarContent>
        <Foot officeShelfOpen={officeShelfOpen} ownShelf={ownShelf} inbox={inbox} inboxOpen={inboxOpen} officeName={officeName} />
        <SidebarRail aria-label="Breite ändern" />
      </Sidebar>
    </SidebarProvider>
  )
}

function Browser({ files, folders, openFolder = null, toolsInHead = false }: { files: FileItem[]; folders: FolderItem[]; openFolder?: string | null; toolsInHead?: boolean }): JSX.Element {
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
      selection={{ active: false, selectedIds: new Set(), onToggle: () => {}, onStart: toolsInHead ? undefined : () => {} }}
      rootToolsInMenu={toolsInHead}
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
        <div className={`bg-background absolute left-8 right-8 z-40 flex flex-col ${tall ? 'top-0 h-[138px] justify-start pt-3' : 'top-[10px] h-[68px] justify-between'}`}>
          <span className="text-muted-foreground text-meta flex items-center gap-1.5">{own ? 'Projektunabhängig' : project.name}</span>
          {tall && <h1 className="text-page-title">Ablage</h1>}
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
        <div className={tall ? 'flex min-h-0 flex-1 flex-col pt-[68px]' : 'contents'}>
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

const PROJECT_PICKS = ['Brandschutzkonzept_Index-D.pdf', 'Fluchtwegplan_EG-2OG.pdf', 'Grundriss_EG_Index-C.pdf', '024-03 ANS_S-Ansicht Süd-West.pdf']

function FromChat(): JSX.Element {
  const picked = new Set([0, 1])
  return (
    <>
      <Rail own={false} openChat={1} gear="none" />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatHeader title="Fluchtweglänge im Erdgeschoss" />
        <div className="mx-auto mt-4 flex w-full max-w-2xl flex-1 flex-col gap-4 px-8">
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
              <MenuRow icon={FolderLock}>Aus meiner Ablage</MenuRow>
              <MenuRow icon={Folder} picked>
                Aus der Projektablage
              </MenuRow>
            </div>
            <div className="bg-sheet shadow-md w-80 rounded-[16px] p-1.5">
              <div className="text-muted-foreground text-meta px-2.5 pb-1 pt-1.5 font-medium">Projektablage · {PROJECTS[0]!.short}</div>
              {PROJECT_PICKS.map((name, index) => (
                <div key={name} className="text-name flex h-9 items-center gap-2.5 rounded-control px-2.5">
                  <span className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] ${picked.has(index) ? 'bg-foreground text-background' : 'border-field-border border'}`}>
                    {picked.has(index) && <Check className="size-3" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-normal">{name}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 px-2.5 pb-1 pt-2">
                <span className="text-muted-foreground text-meta">2 ausgewählt</span>
                <span className="bg-primary text-primary-foreground inline-flex h-7 items-center rounded-control px-2.5 text-xs font-medium">Anhängen</span>
              </div>
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

function folderTrail(folderId: string): string[] {
  const steps: string[] = []
  let parent = REAL_FOLDERS.find((item) => item.id === folderId)?.parentId ?? null
  while (parent) {
    const found = REAL_FOLDERS.find((item) => item.id === parent)
    if (!found) break
    steps.unshift(found.name)
    parent = found.parentId ?? null
  }
  return ['Projektablage', ...steps]
}

function OfficePage({ name, moreOpen }: { name: string; moreOpen: boolean }): JSX.Element {
  const files = OFFICE_FILES.filter((file) => file.folderId !== 'f-own')
  const folders = OFFICE_FOLDERS.filter((item) => item.id !== 'f-own')
  return (
    <>
      <Rail own={false} officeShelfOpen gear="none" officeName={name} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ShelfHeader own={false} form="search" moreOpen={moreOpen} crumb="Musterarchitektur ZT GmbH" office={name} />
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto [&>div.min-h-full]:!min-h-0 [&_[data-testid=folder-breadcrumb-row]]:hidden">
          <Browser key="office" files={files} folders={folders} toolsInHead />
          <ReadStatus text="Alle 6 Dokumente gelesen" />
        </div>
      </div>
    </>
  )
}

function ShelfPage({ own, form, moreOpen, trashOpen, folder }: { own: boolean; form: string; moreOpen: boolean; trashOpen: boolean; folder: string | null }): JSX.Element {
  return (
    <>
      <Rail own={false} section="files" gear="none" />
      {trashOpen && <TrashWindow />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ShelfHeader own={own} form={form} moreOpen={moreOpen} trashOpen={trashOpen} crumb={own ? 'Projektunabhängig' : PROJECTS[0]!.name} />
        <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto [&>div.min-h-full]:!min-h-0 [&_[data-testid=folder-breadcrumb-row]]:hidden`}>
          {!own && !folder && <UnreadHint count={2} />}
          {!own && folder && <FolderPath trail={folderTrail(folder)} name={REAL_FOLDERS.find((item) => item.id === folder)?.name ?? ''} />}
          {own ? <Browser key="own" files={OWN_FILES} folders={OWN_FOLDERS} toolsInHead /> : <Browser key="project" files={REAL_FILES} folders={REAL_FOLDERS} openFolder={folder} toolsInHead />}
          {own ? <ReadStatus text="Alle 6 Dokumente gelesen" /> : folder ? <ReadStatus text="Alle 2 Dokumente gelesen" /> : <ReadStatus text="284 von 286 Dokumenten gelesen ·" open="2 ansehen" />}
        </div>
      </div>
    </>
  )
}

function Talk({ place, settingsOpen, menu, menuForm, lay, inbox }: { place: string; settingsOpen: boolean; menu: string | null; menuForm: string; lay: string; inbox: string }): JSX.Element {
  const own = place === 'me' || place === 'newme'
  return (
    <>
      <Rail own={own} openChat={place === 'newme' ? null : own ? 0 : place === 'project' ? 1 : place === 'shared' ? 2 : null} gear={settingsOpen ? 'menu' : 'none'} rowMenu={menu === 'row' ? 1 : undefined} menuForm={menuForm} shelfCount={lay === 'inside' ? 6 : 0} inbox={inbox} inboxOpen={menu === 'inbox' || menu === 'inboxall'} />
      {(menu === 'inbox' || menu === 'inboxall') && <InboxPanel />}
      {menu === 'inboxall' && <InboxAll />}
      {menu === 'overview' && <ProjectOverview />}
      {place === 'new' || place === 'temp' || place === 'newme' ? <NewChatPage temporary={place === 'temp'} infoOpen={menu === 'info'} lay={lay} across={place === 'newme'} /> : <Page me={own} shared={place === 'shared'} menuOpen={menu === 'head'} />}
    </>
  )
}

export default function PersonalFilesPreview(): JSX.Element {
  const params = useSearchParams()
  const variant = params?.get('v') ?? 'page'
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <div className="bg-background text-foreground relative flex h-dvh overflow-hidden">{variant === 'officepage' ? <OfficePage name={params?.get('name') ?? 'Büroablage'} moreOpen={params?.get('more') === '1'} /> : variant === 'shelf' ? <ShelfPage own={params?.get('shelf') === 'own'} form={params?.get('form') ?? 'search'} moreOpen={params?.get('more') === '1'} trashOpen={params?.get('trash') === '1'} folder={params?.get('folder') ?? null} /> : variant === 'talk' ? <Talk place={params?.get('place') ?? 'me'} settingsOpen={params?.get('settings') === '1'} menu={params?.get('menu') ?? null} menuForm={params?.get('form') ?? 'gear'} lay={params?.get('lay') ?? 'subline'} inbox={params?.get('inbox') ?? 'bell'} /> : variant === 'all' ? <AllProjects page={params?.get('page') === 'automation' ? 'automation' : 'files'} own={params?.get('shelf') === 'own'} /> : variant === 'switch' ? <SwitchPage own={params?.get('shelf') === 'own'} top={params?.get('top') === 'all' ? 'all' : 'project'} mode={params?.get('mode') ?? 'track'} menuOpen={params?.get('open') === '1'} settingsOpen={params?.get('settings') === '1'} titleSwitch={params?.get('pos') === 'title'} /> : variant === 'office' ? <InOfficeShelf /> : variant === 'chat' ? <FromChat /> : <OwnPage />}</div>
    </I18nProvider>
  )
}
