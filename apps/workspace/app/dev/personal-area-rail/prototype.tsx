'use client'

/**
 * PROTOTYPE, not for merge: three ways the rail could hold a personal area next to the projects
 * (concept for ticket 81). Built from the rail's real parts so the shots show the product's own
 * geometry. `?v=a|b|c|d|e|f|g` picks the variant, `?place=me|project|new` where the reader is
 * (`new`, in f: a chat just started). F is E with a top that stays on the project the reader works in.
 */

import type { JSX, ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Archive,
  Bell,
  BookMarked,
  ChevronRight,
  Folder,
  FolderLock,
  LayoutGrid,
  LockKeyhole,
  MessageSquare,
  Plus,
  X,
  Search,
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
import { InboxBadge } from '@/features/collaboration/components'
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

/** A section row, with the rail's own classes (`RailNavItem` in `app-sidebar.tsx`). */
export function NavRow({ icon: Icon, label, active = false, within = false, badge = 0, hint }: { icon: LucideIcon; label: string; active?: boolean; within?: boolean; badge?: number; hint?: string }): JSX.Element {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        className={cn(
          'text-foreground h-9 gap-[11px] rounded-control px-3 text-sm font-medium',
          active ? 'hover:bg-transparent data-[active=true]:bg-transparent font-semibold data-[active=true]:font-semibold' : cn('hover:bg-selected', within && 'font-semibold')
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

const SUB_ROW = 'relative flex h-8 min-w-0 items-center gap-2 rounded-control pl-[39px] pr-3 text-name'

/** A chat under a section, with the rail's own row (`rail-chats.tsx`), plus where it belongs. */
export function ChatRow({ chat, current = false, showProject = false, indent = true, markOwn = false }: { chat: Chat; current?: boolean; showProject?: boolean; indent?: boolean; markOwn?: boolean }): JSX.Element {
  const tag = showProject ? shortName(chat.project) : undefined
  return (
    <li className="relative list-none">
      <a href="#" className={cn(SUB_ROW, !indent && 'pl-3', current ? 'text-foreground font-semibold' : 'text-muted-foreground hover:bg-selected hover:text-foreground')}>
        {current && <span aria-hidden className="bg-sheet absolute inset-0 rounded-control shadow-xs" />}
        <span className="relative min-w-0 flex-1 truncate">{chat.title}</span>
        {chat.shared && <UsersRound aria-label="Geteilt" className="relative size-3.5 shrink-0" />}
        {tag && <span className="text-muted-foreground text-meta relative max-w-[84px] shrink-0 truncate font-normal">{tag}</span>}
        {markOwn && !tag && <UserRound aria-label="Ohne Projekt" className="text-muted-foreground relative size-3.5 shrink-0" />}
      </a>
    </li>
  )
}

export function MoreRow({ label, indent = true }: { label: string; indent?: boolean }): JSX.Element {
  return (
    <li className="list-none">
      <a href="#" className={cn(SUB_ROW, 'text-muted-foreground hover:bg-selected gap-1', !indent && 'pl-3')}>
        <span className="truncate">{label}</span>
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
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

/** A: the switcher at the top chooses the place. „Mein Bereich“ is its first entry; the rail lists that place's sections. */
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

/** B: two floors. „Mein Bereich“ always stands at the top, the project under it; the one the reader is in is open. */
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

/** C: chats first. One list of all chats, each saying where it belongs; the projects are a list above it. */
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

/**
 * D: two zones. The switcher at the top chooses the place and lists what belongs to it; the chats under it are the
 * reader's own, the same list wherever they are.
 */
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

/**
 * E: no place switcher for „Mein Bereich“. The top names the project of the open chat (or none) and is the way to
 * another; every chat says where it belongs; the person's own things stand at the foot, with the person.
 */
function VariantE({ me, sticky = false, current, noneLabel }: { me: boolean; sticky?: boolean; current?: number | null; noneLabel?: string }): JSX.Element {
  // G: the top follows the open chat, and for a chat without a project it states that instead of asking for one.
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
          <NavRow icon={Search} label="Suche" />
          <NavRow icon={Bell} label="Postfach" badge={3} />
        </SidebarMenu>
      </nav>
      {/* The person's own Ablage beside the office's: neither belongs to a project. */}
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

/** The page beside the rail: enough of a chat to say where the reader is and who reads along. */
export function Page({ me, fresh = false, noneLabel = 'Ohne Projekt' }: { me: boolean; fresh?: boolean; noneLabel?: string }): JSX.Element {
  const project = PROJECTS[0]!.name
  // „Alle Projekte“: the chat is bound to no project and may look into every one the reader can open.
  const across = me && noneLabel === 'Alle Projekte'
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 px-8 pb-4 pt-6">
        <span className="text-muted-foreground text-meta">{across ? 'Projektübergreifend' : me ? noneLabel : project}</span>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-pane-title">{fresh ? 'Neuer Chat' : me ? 'Rampenneigung Tiefgarage' : 'Fluchtweglänge im Erdgeschoss'}</h1>
          <span className="bg-sheet shadow-press text-name inline-flex h-7 items-center gap-1.5 rounded-full px-2.5">
            <LockKeyhole className="size-3.5" aria-hidden />
            Nur Sie
          </span>
        </div>
        {across && <p className="text-muted-foreground mt-1 text-sm">An kein Projekt gebunden. {PRODUCT} kann in allen Ihren Projekten nachsehen, auch in abgeschlossenen.</p>}
      </header>
      <div className="flex-1" />
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
  // What the top says for a chat without a project (g): `?label=`.
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
