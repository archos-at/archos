'use client'

// PROTOTYPE, not for merge: ways the rail could hold a person's own chats next to the projects (concept for ticket 81).

import type { JSX, ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Archive,
  ArrowUp,
  AtSign,
  Bell,
  ChevronDown,
  Folder,
  FolderInput,
  FolderLock,
  Library,
  LayoutGrid,
  LockKeyhole,
  Paperclip,
  Mic,
  Mail,
  HatGlasses,
  MoreHorizontal,
  PencilLine,
  Trash2,
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

export const ALL_CHATS: Chat[] = [MY_CHATS[0]!, MY_CHATS[1]!, { title: 'Abgleich Statik, Planstand Oktober', project: 'p-1', shared: true }, MY_CHATS[2]!, MY_CHATS[3]!]

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

export function Foot({ personalDoor = false, officeShelfOpen = false, ownShelf, inbox = 'org', inboxOpen = false, officeName = 'Büroablage' }: { personalDoor?: boolean; officeShelfOpen?: boolean; ownShelf?: 'idle' | 'open'; inbox?: string; inboxOpen?: boolean; officeName?: string }): JSX.Element {
  return (
    <SidebarFooter className="shrink-0 gap-0 p-0 px-3 pb-3 pt-4">
      <nav aria-label={OFFICE} className="mb-2 w-full">
        <div className="text-muted-foreground text-meta flex min-h-6 items-end px-3 pb-1.5 font-medium">{OFFICE}</div>
        <SidebarMenu className="gap-0.5">
          <NavRow icon={Archive} label={officeName} active={officeShelfOpen} />
          <NavRow icon={Library} label="Grundlagen" />
          <NavRow icon={Search} label="Suche" />
          {inbox === 'org' && <NavRow icon={Bell} label="Postfach" badge={8} active={inboxOpen} />}
        </SidebarMenu>
      </nav>
      {inbox === 'person' && (
        <SidebarMenu className="border-hairline mb-1 gap-0.5 border-t pt-2">
          <NavRow icon={Bell} label="Postfach" badge={8} active={inboxOpen} />
        </SidebarMenu>
      )}
      {inbox === 'line' && (
        <a href="#" className={cn('border-hairline text-meta mb-1 flex items-center gap-2 border-t px-3 pb-1 pt-3', inboxOpen ? 'text-foreground font-medium' : 'text-muted-foreground')}>
          <Bell className="size-3.5" aria-hidden />
          8 Einträge warten auf Sie
        </a>
      )}
      <div className="relative">
        {inbox === 'bell' && (
          <span title="Postfach" className={cn('absolute right-9 top-1/2 z-10 flex h-7 -translate-y-1/2 items-center gap-1 rounded-control px-1.5', inboxOpen ? 'bg-sheet shadow-xs' : '')}>
            <Bell className="size-4" aria-label="Postfach" />
            <span className="bg-foreground text-background text-meta flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-medium">8</span>
          </span>
        )}
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
      </div>
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
    <span title="Temporärer Chat" className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2 text-xs font-medium', on ? 'bg-foreground text-background' : 'text-muted-foreground')}>
      <HatGlasses className="size-[18px]" aria-label="Temporärer Chat" />
      {on && 'Temporär'}
    </span>
  )
}

function OnlyYouBadge({ quiet = false }: { quiet?: boolean }): JSX.Element {
  return (
    <span className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full text-xs font-medium', quiet ? 'px-0' : 'bg-desk px-2.5')}>
      <LockKeyhole className="size-3.5" aria-hidden />
      Nur Sie
    </span>
  )
}

function OnlyYouInfo(): JSX.Element {
  return (
    <div className="bg-sheet shadow-md absolute left-1/2 top-full z-30 mt-2 w-80 -translate-x-1/2 rounded-[16px] p-4 text-left">
      <p className="text-name">Nur Sie sehen diesen Chat.</p>
      <p className="text-muted-foreground mt-1.5 text-xs leading-5">Weder Kolleg:innen noch die Administrator:innen Ihres Büros können ihn lesen. Ihr Büro sieht, wie viele Punkte Sie verbrauchen, nie wofür. Andere sehen den Chat erst, wenn Sie ihn teilen.</p>
    </div>
  )
}

const AI_NOTE = `${PRODUCT} ist ein KI-System — Antworten können falsch sein; prüfen Sie sie anhand der zitierten Unterlagen.`

function MailHint({ chip = false }: { chip?: boolean }): JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-2 text-xs', chip ? 'bg-sheet shadow-press h-8 rounded-full px-3' : 'text-muted-foreground')}>
      <Mail className="size-3.5" aria-hidden />
      6 E-Mails warten auf Ablage
      <span className="text-foreground font-medium underline underline-offset-2">Ansehen</span>
    </span>
  )
}

export function NewChatPage({ temporary, infoOpen = false, lay = 'subline', across = false }: { temporary: boolean; infoOpen?: boolean; lay?: string; across?: boolean }): JSX.Element {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-end gap-3 px-8 pb-2 pt-2">
        <TemporaryToggle on={temporary} />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 pb-24">
        <div className="flex flex-col items-center gap-3 text-center">
          {temporary ? (
            <>
              <HatGlasses className="size-7" aria-hidden />
              <h1 className="text-page-title">Temporärer Chat</h1>
              <p className="text-muted-foreground max-w-sm text-sm">Nur Sie sehen diesen Chat. Er steht in keiner Liste, {PRODUCT} merkt sich nichts daraus, und er wird gelöscht, sobald Sie ihn verlassen.</p>
            </>
          ) : (
            <>
              <h1 className="text-page-title">Guten Morgen, Anna.</h1>
              {lay === 'subline' && (
                <div className="relative">
                  <p className={cn('text-muted-foreground inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-sm', infoOpen && 'bg-desk text-foreground')}>
                    <LockKeyhole className="size-3.5" aria-hidden />
                    Nur Sie sehen diesen Chat.
                  </p>
                  {infoOpen && <OnlyYouInfo />}
                </div>
              )}
              {lay === 'greeting' && (
                <>
                  <div className="relative">
                    <OnlyYouBadge />
                    {infoOpen && <OnlyYouInfo />}
                  </div>
                  <MailHint chip />
                </>
              )}
            </>
          )}
        </div>
        <div className="w-full max-w-[720px]">
          {!temporary && lay === 'above' && (
            <div className="flex items-center justify-between px-1 pb-2">
              <OnlyYouBadge quiet />
              <MailHint />
            </div>
          )}
          <div className={cn('bg-sheet flex flex-col gap-6 rounded-[16px] px-4 pb-3 pt-4', temporary ? 'border-foreground border border-dashed' : 'shadow-md')}>
            <span className="text-muted-foreground text-sm">{across ? `Fragen Sie ${PRODUCT}, über alle Ihre Projekte hinweg …` : `Fragen Sie ${PRODUCT} zu diesem Projekt …`}</span>
            <div className="text-muted-foreground flex items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5 underline underline-offset-2">
                <AtSign className="size-3.5" aria-hidden />
                Kollegin oder Kollegen erwähnen
              </span>
              <span className="text-foreground ml-auto inline-flex items-center gap-4">
                {!temporary && lay === 'inside' && <OnlyYouBadge />}
                <span className="inline-flex items-center gap-1 font-medium">
                  Mittel
                  <ChevronDown className="size-3.5" aria-hidden />
                </span>
              </span>
              <Paperclip className="text-foreground size-4" aria-hidden />
              <Mic className="text-foreground size-4" aria-hidden />
              <span className="bg-muted-foreground text-background flex size-7 items-center justify-center rounded-control">
                <ArrowUp className="size-4" aria-hidden />
              </span>
            </div>
          </div>
          {!temporary && !across && lay === 'subline' && (
            <div className="flex justify-center pt-3">
              <MailHint chip />
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

export function Page({ me, shared = false, menuOpen = false }: { me: boolean; shared?: boolean; menuOpen?: boolean }): JSX.Element {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatHeader title={shared ? 'Abgleich Statik, Planstand Oktober' : me ? 'Rampenneigung Tiefgarage' : 'Fluchtweglänge im Erdgeschoss'} shared={shared} menuOpen={menuOpen} />
      <div className="mx-auto mt-6 flex w-full max-w-2xl flex-1 flex-col gap-5 px-8">
        <div className="bg-desk text-name max-w-[80%] self-end rounded-[16px] px-3 py-2 font-normal">{me ? 'Wie steil darf die Rampe einer Tiefgarage sein?' : 'Wie lang darf der Fluchtweg im Erdgeschoss sein?'}</div>
        <div className="flex max-w-[90%] flex-col gap-2.5">
          <div className="bg-selected h-2 w-[96%] rounded" />
          <div className="bg-selected h-2 w-[88%] rounded" />
          <div className="bg-selected h-2 w-[61%] rounded" />
        </div>
      </div>
      <div className="mx-auto mb-6 w-full max-w-2xl px-8">
        <div className="bg-sheet border-field-border flex flex-col gap-3 rounded-[10px] border p-3">
          <span className="text-muted-foreground text-sm">Frage stellen …</span>
        </div>
        <p className="text-muted-foreground text-meta pt-2 text-center">{AI_NOTE}</p>
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
          <VariantE me={me} noneLabel={noneLabel} current={fresh ? null : undefined} />
          <Foot personalDoor={['e', 'f'].includes(variant)} />
          <SidebarRail aria-label="Breite ändern" />
        </Sidebar>
      </SidebarProvider>
      <Page me={me} />
    </div>
  )
}
