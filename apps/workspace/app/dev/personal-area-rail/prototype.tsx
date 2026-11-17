'use client'

// PROTOTYPE, not for merge: ways the rail could hold a person's own chats next to the projects (concept for ticket 81).

import type { JSX, ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Archive,
  Bell,
  BookMarked,
  ChevronRight,
  Folder,
  FolderInput,
  FolderLock,
  Library,
  LayoutGrid,
  LockKeyhole,
  HatGlasses,
  MoreHorizontal,
  PencilLine,
  Trash2,
  MessageSquare,
  Plus,
  Search,
  Share2,
  UserRound,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import { ProjectSwitcher } from '@/components/shell/project-switcher'
import { recordRecentProject } from '@/components/shell/recent-projects'
import { SidebarBrand } from '@/components/shell/sidebar-brand'
import { SidebarUserMenu } from '@/components/shell/sidebar-user-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
} from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { InboxBadge } from '@/features/collaboration/components'
import { ParticipantStrip } from '@/features/collaboration/components/ParticipantStrip'
import type { ResourceAccessEntry } from '@/lib/sharing/types'
import identity from '@/shared/brand/identity.json'
import { cn } from '@/lib/utils'

const ME = { id: 'me', name: 'Mein Bereich' }
export const PROJECTS = [
  { id: 'p-1', name: 'Wohnbau Seestadt Baufeld D12', short: 'Seestadt D12' },
  { id: 'p-2', name: 'Sanierung Amtshaus Favoriten', short: 'Amtshaus' },
  { id: 'p-4', name: 'Bürohaus Lände 3', short: 'Lände 3' },
  { id: 'p-5', name: 'Kindergarten Stammersdorf', short: 'Kindergarten' },
]
const USER = { name: 'Anna Berger', email: 'anna.berger@example.at' }
const OFFICE = 'Musterarchitektur ZT GmbH'
const PRODUCT = identity.name

interface Chat {
  title: string
  project?: string
  shared?: boolean
}
const MY_CHATS: Chat[] = [
  { title: 'Rampenneigung Tiefgarage' },
  { title: 'Fluchtweglänge im Erdgeschoss', project: 'p-1' },
  { title: 'Agenda Jour fixe Donnerstag' },
  { title: 'Stellplatzverpflichtung Wien', project: 'p-2' },
  { title: 'Brandabschnitte Tiefgarage', project: 'p-1' },
]
const PROJECT_CHATS: Chat[] = [
  { title: 'Fluchtweglänge im Erdgeschoss' },
  { title: 'Abgleich Statik, Planstand Oktober', shared: true },
  { title: 'Brandabschnitte Tiefgarage' },
  { title: 'Barrierefreiheit Sanitärräume' },
]

if (typeof window !== 'undefined') {
  recordRecentProject('p-2')
  recordRecentProject('p-1')
}

const shortName = (id?: string): string | undefined => PROJECTS.find((p) => p.id === id)?.short

export function NavRow({ icon: Icon, label, active = false, within = false, badge = 0, hint }: { icon: LucideIcon; label: string; active?: boolean; within?: boolean; badge?: number; hint?: string }): JSX.Element {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        className={cn(
          'text-muted-foreground h-9 gap-[11px] rounded-control px-3 text-[13px] font-normal hover:text-foreground',
          active ? 'text-foreground data-[active=true]:text-foreground hover:bg-transparent data-[active=true]:bg-transparent font-medium data-[active=true]:font-medium' : cn('hover:bg-selected', within && 'text-foreground font-medium')
        )}
      >
        <a href="#" aria-current={active ? 'page' : undefined}>
          {active && <span aria-hidden className="bg-sheet absolute inset-0 rounded-control shadow-xs" />}
          <Icon aria-hidden className={cn('relative size-4 shrink-0', !active && !within && 'text-muted-foreground')} />
          <span className="relative truncate">{label}</span>
          {hint && <span className="text-muted-foreground text-meta relative ml-auto font-normal">{hint}</span>}
          <InboxBadge pending={badge} tone="muted" className="relative ml-auto" />
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

const SUB_ROW = 'relative flex h-8 min-w-0 items-center gap-2 rounded-control pl-[39px] pr-3 text-[13px]'

export function ThreadMenu({ className, inProject = false }: { className?: string; inProject?: boolean }): JSX.Element {
  return (
    <div className={cn('bg-sheet shadow-md text-foreground absolute z-50 w-60 rounded-[16px] p-1.5 text-[13px] font-normal', className)}>
      <div className="flex h-9 items-center gap-2.5 rounded-control px-2.5">
        <PencilLine className="text-muted-foreground size-4 shrink-0" aria-hidden />
        Umbenennen
      </div>
      <div className="flex h-9 items-center gap-2.5 rounded-control px-2.5">
        <FolderInput className="text-muted-foreground size-4 shrink-0" aria-hidden />
        {inProject ? 'Verschieben' : 'In ein Projekt verschieben'}
      </div>
      <div className="bg-desk mx-1 my-1 h-px" />
      <div className="text-destructive flex h-9 items-center gap-2.5 rounded-control px-2.5">
        <Trash2 className="size-4 shrink-0" aria-hidden />
        Löschen
      </div>
    </div>
  )
}

export function ChatRow({ chat, current = false, showProject = false, indent = true, markOwn = false, hovered = false, menuOpen = false }: { chat: Chat; current?: boolean; showProject?: boolean; indent?: boolean; markOwn?: boolean; hovered?: boolean; menuOpen?: boolean }): JSX.Element {
  const tag = showProject ? shortName(chat.project) : undefined
  return (
    <li className="relative list-none">
      <a href="#" className={cn(SUB_ROW, !indent && 'pl-3', current ? 'text-foreground font-medium' : hovered ? 'bg-selected text-foreground' : 'text-muted-foreground hover:bg-selected hover:text-foreground')}>
        {current && <span aria-hidden className="bg-sheet absolute inset-0 rounded-control shadow-xs" />}
        <span className="relative min-w-0 flex-1 truncate">{chat.title}</span>
        {chat.shared && <UsersRound aria-label="Geteilt" className="relative size-3.5 shrink-0" />}
        {tag && <span className="text-muted-foreground text-meta relative max-w-[84px] shrink-0 truncate font-normal">{tag}</span>}
        {markOwn && !tag && <UserRound aria-label="Ohne Projekt" className="text-muted-foreground relative size-3.5 shrink-0" />}
        {hovered && (
          <span className={cn('relative -mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-control', menuOpen && 'bg-pressed')}>
            <MoreHorizontal aria-label="Mehr" className="size-4" />
          </span>
        )}
      </a>
      {menuOpen && <ThreadMenu className="right-0 top-full mt-1" inProject={Boolean(chat.project)} />}
    </li>
  )
}

export function MoreRow({ label, indent = true }: { label: string; indent?: boolean }): JSX.Element {
  return (
    <li className="list-none">
      <a href="#" className={cn(SUB_ROW, 'text-muted-foreground text-meta gap-1 font-medium', !indent && 'pl-3')}>
        <span className="truncate">{label}</span>
      </a>
    </li>
  )
}

export function GroupLabel({ children }: { children: ReactNode }): JSX.Element {
  return <div className="text-muted-foreground text-meta flex min-h-6 items-end px-3 pb-1.5 pt-4 font-medium">{children}</div>
}

function ProjectSections({ open, currentChat }: { open: boolean; currentChat: number | null }): JSX.Element {
  return (
    <SidebarMenu className="gap-0.5">
      <NavRow icon={MessageSquare} label="Chat" within={open && currentChat !== null} />
      {open && (
        <ul className="flex flex-col gap-0.5 pt-0.5">
          {PROJECT_CHATS.map((chat, index) => (
            <ChatRow key={chat.title} chat={chat} current={index === currentChat} />
          ))}
          <MoreRow label="Alle Chats" />
        </ul>
      )}
      <NavRow icon={Folder} label="Dateien" />
      <NavRow icon={LayoutGrid} label="Übersicht" />
      <NavRow icon={Zap} label="Automatisierung" />
    </SidebarMenu>
  )
}

function PersonalSections({ currentChat }: { currentChat: number | null }): JSX.Element {
  return (
    <SidebarMenu className="gap-0.5">
      <NavRow icon={MessageSquare} label="Chats" within={currentChat !== null} />
      <ul className="flex flex-col gap-0.5 pt-0.5">
        {MY_CHATS.map((chat, index) => (
          <ChatRow key={chat.title} chat={chat} current={index === currentChat} showProject />
        ))}
        <MoreRow label="Alle Chats" />
      </ul>
      <NavRow icon={BookMarked} label="Gedächtnis" />
      <NavRow icon={Zap} label="Abläufe" hint="später" />
    </SidebarMenu>
  )
}

function VariantA({ me }: { me: boolean }): JSX.Element {
  return (
    <>
      <SidebarHeader className="shrink-0 gap-0 p-0 px-3">
        <SidebarBrand iconRail={false} />
        <div className="mt-1 flex items-center">
          <ProjectSwitcher projects={[ME, ...PROJECTS]} activeProjectId={me ? 'me' : 'p-1'} />
        </div>
      </SidebarHeader>
      <SidebarContent className="mt-3 flex-1 gap-0 overflow-y-auto px-3 py-px">{me ? <PersonalSections currentChat={0} /> : <ProjectSections open currentChat={0} />}</SidebarContent>
    </>
  )
}

function VariantB({ me }: { me: boolean }): JSX.Element {
  return (
    <>
      <SidebarHeader className="shrink-0 gap-0 p-0 px-3">
        <SidebarBrand iconRail={false} />
      </SidebarHeader>
      <SidebarContent className="mt-1 flex-1 gap-0 overflow-y-auto px-3 py-px">
        <SidebarMenu className="gap-0.5">
          <NavRow icon={LockKeyhole} label="Mein Bereich" within={me} />
          {me && (
            <ul className="flex flex-col gap-0.5 pt-0.5">
              {MY_CHATS.slice(0, 4).map((chat, index) => (
                <ChatRow key={chat.title} chat={chat} current={index === 0} showProject />
              ))}
              <MoreRow label="Alle Chats" />
              <li className="list-none">
                <a href="#" className={cn(SUB_ROW, 'text-muted-foreground')}>
                  Gedächtnis
                </a>
              </li>
            </ul>
          )}
        </SidebarMenu>
        <GroupLabel>Projekt</GroupLabel>
        <div className="mb-3 flex items-center">
          <ProjectSwitcher projects={PROJECTS} activeProjectId="p-1" />
        </div>
        <ProjectSections open={!me} currentChat={me ? null : 0} />
      </SidebarContent>
    </>
  )
}

function VariantC({ me }: { me: boolean }): JSX.Element {
  return (
    <>
      <SidebarHeader className="shrink-0 gap-0 p-0 px-3">
        <SidebarBrand iconRail={false} />
        <a href="#" className="bg-primary text-primary-foreground mt-1 flex h-9 items-center justify-center gap-2 rounded-control text-sm font-medium">
          <Plus className="size-4" aria-hidden />
          Neuer Chat
        </a>
      </SidebarHeader>
      <SidebarContent className="mt-3 flex-1 gap-0 overflow-y-auto px-3 py-px">
        <SidebarMenu className="gap-0.5">
          <NavRow icon={LockKeyhole} label="Mein Bereich" />
        </SidebarMenu>
        <GroupLabel>Projekte</GroupLabel>
        <SidebarMenu className="gap-0.5">
          <NavRow icon={Folder} label={PROJECTS[0]!.name} within={!me} />
          {!me && (
            <ul className="flex flex-col gap-0.5 pt-0.5">
              {['Dateien', 'Übersicht', 'Automatisierung'].map((label) => (
                <li key={label} className="list-none">
                  <a href="#" className={cn(SUB_ROW, 'text-muted-foreground')}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <NavRow icon={Folder} label={PROJECTS[1]!.name} />
          <NavRow icon={Folder} label={PROJECTS[2]!.name} />
          <ul>
            <MoreRow label="Alle Projekte" />
          </ul>
        </SidebarMenu>
        <GroupLabel>Chats</GroupLabel>
        <ul className="flex flex-col gap-0.5">
          {MY_CHATS.map((chat, index) => (
            <ChatRow key={chat.title} chat={chat} current={index === (me ? 0 : 1)} showProject indent={false} />
          ))}
          <MoreRow label="Alle Chats" indent={false} />
        </ul>
      </SidebarContent>
    </>
  )
}

export const ALL_CHATS: Chat[] = [MY_CHATS[0]!, MY_CHATS[1]!, { title: 'Abgleich Statik, Planstand Oktober', project: 'p-1', shared: true }, MY_CHATS[2]!, MY_CHATS[3]!]

function VariantD({ me }: { me: boolean }): JSX.Element {
  return (
    <>
      <SidebarHeader className="shrink-0 gap-0 p-0 px-3">
        <SidebarBrand iconRail={false} />
        <div className="mt-1 flex items-center">
          <ProjectSwitcher projects={[ME, ...PROJECTS]} activeProjectId={me ? 'me' : 'p-1'} />
        </div>
      </SidebarHeader>
      <SidebarContent className="mt-3 flex-1 gap-0 overflow-y-auto px-3 py-px">
        <SidebarMenu className="gap-0.5">
          <NavRow icon={Folder} label="Dateien" />
          {me ? <NavRow icon={BookMarked} label="Gedächtnis" /> : <NavRow icon={LayoutGrid} label="Übersicht" />}
          {me ? <NavRow icon={Zap} label="Abläufe" /> : <NavRow icon={Zap} label="Automatisierung" />}
        </SidebarMenu>
        <a href="#" className="bg-primary text-primary-foreground mt-6 flex h-9 shrink-0 items-center justify-center gap-2 rounded-control text-sm font-medium">
          <Plus className="size-4" aria-hidden />
          Neuer Chat
        </a>
        <div className="flex items-end justify-between">
          <GroupLabel>Chats</GroupLabel>
          {!me && (
            <div className="bg-selected text-meta mb-1 flex rounded-control p-0.5 font-medium">
              <span className="bg-sheet shadow-xs rounded-[4px] px-2 py-0.5">Alle</span>
              <span className="text-muted-foreground px-2 py-0.5">Dieses Projekt</span>
            </div>
          )}
        </div>
        <ul className="flex flex-col gap-0.5">
          {ALL_CHATS.map((chat, index) => (
            <ChatRow key={chat.title} chat={chat} current={index === (me ? 0 : 1)} showProject indent={false} />
          ))}
          <MoreRow label="Alle Chats" indent={false} />
        </ul>
      </SidebarContent>
    </>
  )
}

function VariantE({ me, sticky = false, current, noneLabel }: { me: boolean; sticky?: boolean; current?: number | null; noneLabel?: string }): JSX.Element {
  const none = { id: 'none', name: noneLabel ?? '' }
  const showProject = sticky || !me
  const open = current === undefined ? (me ? 0 : 1) : current
  return (
    <>
      <SidebarHeader className="shrink-0 gap-0 p-0 px-3">
        <SidebarBrand iconRail={false} />
        <div className="mt-1 flex items-center">
          <ProjectSwitcher projects={noneLabel ? [none, ...PROJECTS] : PROJECTS} activeProjectId={showProject ? 'p-1' : noneLabel ? 'none' : undefined} />
        </div>
      </SidebarHeader>
      <SidebarContent className="mt-3 flex-1 gap-0 overflow-y-auto px-3 py-px">
        {showProject && (
          <SidebarMenu className="mb-6 gap-0.5">
            <NavRow icon={Folder} label="Dateien" />
            <NavRow icon={LayoutGrid} label="Übersicht" />
            <NavRow icon={Zap} label="Automatisierung" />
          </SidebarMenu>
        )}
        <a href="#" className="bg-sheet shadow-press flex h-9 shrink-0 items-center justify-center gap-2 rounded-control text-sm font-medium">
          <Plus className="size-4" aria-hidden />
          Neuer Chat
        </a>
        <GroupLabel>Chats</GroupLabel>
        <ul className="flex flex-col gap-0.5">
          {ALL_CHATS.map((chat, index) => (
            <ChatRow key={chat.title} chat={chat} current={index === open} showProject markOwn={!sticky && !noneLabel} indent={false} />
          ))}
          <MoreRow label="Alle Chats" indent={false} />
        </ul>
      </SidebarContent>
    </>
  )
}

export function Foot({ personalDoor = false, officeShelfOpen = false, ownShelf }: { personalDoor?: boolean; officeShelfOpen?: boolean; ownShelf?: 'idle' | 'open' }): JSX.Element {
  return (
    <SidebarFooter className="shrink-0 gap-0 p-0 px-3 pb-3 pt-4">
      <nav aria-label={OFFICE} className="mb-2 w-full">
        <div className="text-muted-foreground text-meta flex min-h-6 items-end px-3 pb-1.5 font-medium">{OFFICE}</div>
        <SidebarMenu className="gap-0.5">
          <NavRow icon={Archive} label="Büroablage" active={officeShelfOpen} />
          <NavRow icon={Library} label="Grundlagen" />
          <NavRow icon={Search} label="Suche" />
          <NavRow icon={Bell} label="Postfach" badge={3} />
        </SidebarMenu>
      </nav>
      {ownShelf && (
        <SidebarMenu className="mb-2 gap-0.5">
          <NavRow icon={FolderLock} label="Meine Ablage" active={ownShelf === 'open'} />
        </SidebarMenu>
      )}
      {personalDoor && (
        <SidebarMenu className="mb-2 gap-0.5">
          <NavRow icon={LockKeyhole} label="Mein Bereich" />
        </SidebarMenu>
      )}
      <SidebarUserMenu user={USER} organizationName={OFFICE} authRequired={false} compact={false} avatarSizeClass="size-6" menuSide="top" menuAlign="end" menuSideOffset={6} menuMatchTrigger canViewOrganization canManageOrganization={false} canManagePlatform={false} />
    </SidebarFooter>
  )
}

const PILL = 'flex min-h-8 items-center gap-0.5 rounded-surface border border-base bg-card/60 p-0.5'
const person = (userId: string, name: string): ResourceAccessEntry => ({
  person: { userId, name, email: `${userId}@example.at`, profilePictureUrl: null },
  role: userId === 'anna' ? 'owner' : 'collaborator',
  reason: userId === 'anna' ? 'creator' : 'grant',
  grantedBy: null,
})
const SHARED_WITH = [person('anna', 'Anna Berger'), person('florian', 'Florian Huber')]

export function ChatHeader({ title, shared = false, menuOpen = false, changed = '17.11.2026' }: { title: string; shared?: boolean; menuOpen?: boolean; changed?: string }): JSX.Element {
  return (
    <header className="flex items-start justify-between gap-3 px-8 pb-2 pt-2">
      <div className={cn(PILL, 'relative min-w-0')}>
        <span className="truncate pl-2.5 pr-1 text-sm font-medium">{title}</span>
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-control', menuOpen && 'bg-selected')}>
          <MoreHorizontal aria-label="Mehr" className="size-4" />
        </span>
        <div aria-hidden className="bg-border mx-1 h-4 w-px shrink-0" />
        <span className="text-muted-foreground shrink-0 pl-1 pr-2.5 text-xs">Geändert am {changed}</span>
        {menuOpen && <ThreadMenu className="left-0 top-full mt-1.5" />}
      </div>
      <div className={cn(PILL, 'shrink-0')}>
        <div className="flex items-center gap-1 pl-1.5 pr-1.5">
          {shared ? (
            <ParticipantStrip entries={SHARED_WITH} currentUserId="anna" />
          ) : (
            <span className="inline-flex items-center gap-1.5 pl-0.5 text-xs font-medium">
              <LockKeyhole className="size-3.5" aria-hidden />
              Nur Sie
            </span>
          )}
          <div aria-hidden className="bg-border ml-1 h-4 w-px" />
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 rounded-control px-2">
          <Share2 className="size-4" aria-hidden />
          <span className="text-xs font-medium">Teilen</span>
        </Button>
      </div>
    </header>
  )
}

export function NewChatButton(): JSX.Element {
  return (
    <a href="#" className="bg-sheet shadow-press flex h-9 shrink-0 items-center justify-start gap-[11px] rounded-control px-3 text-[13px] font-medium">
      <Plus className="size-4" aria-hidden />
      Neuer Chat
    </a>
  )
}

function TemporaryToggle({ on }: { on: boolean }): JSX.Element {
  return (
    <div className={cn(PILL, 'shrink-0')}>
      <span title="Temporärer Chat" className={cn('flex h-7 items-center gap-1.5 rounded-control px-2 text-xs font-medium', on && 'bg-foreground text-background')}>
        <HatGlasses className="size-4" aria-label="Temporärer Chat" />
        {on && 'Temporär'}
      </span>
    </div>
  )
}

export function NewChatPage({ temporary }: { temporary: boolean }): JSX.Element {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-start justify-end gap-3 px-8 pb-2 pt-2">
        <TemporaryToggle on={temporary} />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        {temporary ? (
          <>
            <HatGlasses className="size-7" aria-hidden />
            <h1 className="text-pane-title">Temporärer Chat</h1>
            <p className="text-muted-foreground max-w-sm text-sm">Nur Sie sehen diesen Chat. Er steht in keiner Liste, {PRODUCT} merkt sich nichts daraus, und er wird gelöscht, sobald Sie ihn verlassen.</p>
          </>
        ) : (
          <h1 className="text-pane-title">Womit kann ich helfen?</h1>
        )}
      </div>
      <div className="mx-auto mb-8 w-full max-w-2xl px-8">
        <div className={cn('bg-sheet flex flex-col gap-3 rounded-[10px] border p-3', temporary ? 'border-foreground border-dashed' : 'border-field-border')}>
          <span className="text-muted-foreground text-sm">Frage stellen …</span>
        </div>
      </div>
    </main>
  )
}

export function Page({ me, fresh = false, shared = false, menuOpen = false, noneLabel = 'Ohne Projekt' }: { me: boolean; fresh?: boolean; shared?: boolean; menuOpen?: boolean; noneLabel?: string }): JSX.Element {
  const across = me && noneLabel === 'Alle Projekte'
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatHeader title={fresh ? 'Neuer Chat' : shared ? 'Abgleich Statik, Planstand Oktober' : me ? 'Rampenneigung Tiefgarage' : 'Fluchtweglänge im Erdgeschoss'} shared={shared} menuOpen={menuOpen} />
      <div className="flex flex-1 items-center justify-center px-8">
        {across && <p className="text-muted-foreground max-w-md text-center text-sm">An kein Projekt gebunden. {PRODUCT} kann in allen Ihren Projekten nachsehen, auch in abgeschlossenen.</p>}
      </div>
      <div className="mx-auto mb-8 w-full max-w-2xl px-8">
        <div className="bg-sheet border-field-border flex flex-col gap-3 rounded-[10px] border p-3">
          <span className="text-muted-foreground text-sm">Frage stellen …</span>
        </div>
      </div>
    </main>
  )
}

export function PersonalAreaRailPreview(): JSX.Element {
  const params = useSearchParams()
  const variant = params?.get('v') ?? 'a'
  const place = params?.get('place') ?? 'me'
  const me = place === 'me'
  const fresh = place === 'new'
  const noneLabel = params?.get('label') ?? 'Ohne Projekt'
  return (
    <div className="bg-background text-foreground flex h-dvh overflow-hidden">
      <SidebarProvider className="h-full min-h-0 w-auto shrink-0">
        <Sidebar collapsible="icon" data-scope="project" aria-label="Navigation">
          {variant === 'g' ? <VariantE me={me} noneLabel={noneLabel} current={fresh ? null : undefined} /> : variant === 'f' ? <VariantE me={me} sticky current={fresh ? null : undefined} /> : variant === 'e' ? <VariantE me={me} /> : variant === 'd' ? <VariantD me={me} /> : variant === 'c' ? <VariantC me={me} /> : variant === 'b' ? <VariantB me={me} /> : <VariantA me={me} />}
          <Foot personalDoor={['e', 'f'].includes(variant)} />
          <SidebarRail aria-label="Breite ändern" />
        </Sidebar>
      </SidebarProvider>
      <Page me={me} fresh={fresh} noneLabel={variant === 'g' && noneLabel === 'Projekte' ? 'Ohne Projekt' : noneLabel} />
    </div>
  )
}
