'use client'

// PROTOTYPE, not for merge: the search window and the folded rail with its fly-out (concept for ticket 81).

import type { JSX, ReactNode } from 'react'
import { Archive, ArrowRight, Bell, CornerDownLeft, FileText, Folder, BookMarked, Building2, LockKeyhole, LogOut, MessageSquare, Moon, PanelLeft, UserRound, Search, SquarePen, Zap, type LucideIcon } from 'lucide-react'

import { ProjectSwitcher } from '@/components/shell/project-switcher'
import { SidebarMenu, SidebarProvider } from '@/components/ui/sidebar'
import { Logo } from '@/components/brand/logo'
import identity from '@/shared/brand/identity.json'
import { ALL_CHATS, ChatRow, MoreRow, NavRow, PROJECTS } from '../personal-area-rail/prototype'
import { InboxPopover } from './inbox-panel'
import { SpaceToggle, useProjectIcon } from './project-menu'

const KEY = 'bg-sheet shadow-xs text-meta rounded-[4px] px-1.5 py-0.5 font-medium'

export function BrandRow({ hint = false }: { hint?: boolean }): JSX.Element {
  return (
    <div className="flex min-h-14 items-center pl-3 pr-1.5">
      <Logo kind="wordmark" size="small" />
      <span className="text-muted-foreground ml-auto flex items-center gap-0.5">
        <span className="relative">
          <span className={`flex size-7 items-center justify-center rounded-control ${hint ? 'bg-selected text-foreground' : ''}`}>
            <Search className="size-4" aria-label="Suche" />
          </span>
          {hint && (
            <span className="bg-sheet shadow-md text-foreground text-meta absolute left-1/2 top-full z-50 mt-1.5 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-control px-2 py-1">
              Suche
              <span className="text-muted-foreground">Strg K</span>
            </span>
          )}
        </span>
        <span className="flex size-7 items-center justify-center">
          <PanelLeft className="size-4" aria-label="Leiste einklappen" />
        </span>
      </span>
    </div>
  )
}

const HITS = [
  { icon: FileText, name: 'Brandschutzkonzept_Wohnhausanlage_Index-D.pdf', where: 'Wohnbau Seestadt Baufeld D12 · Abgabepläne', why: 'S. 7: „Fluchtweglänge max. 40 m“' },
  { icon: FileText, name: 'Grundriss_EG_Index-C.pdf', where: 'Wohnbau Seestadt Baufeld D12 · Abgabepläne', why: 'S. 1: „Fluchtweg Stiege 2“' },
  { icon: FileText, name: 'OIB-Richtlinie 2: Brandschutz', where: 'Bürobibliothek · Normen & Richtlinien', why: 'S. 9: „Fluchtweglänge“' },
]
const RECENT = [
  { icon: FileText, name: 'Grundriss_EG_Index-C.pdf', where: 'Wohnbau Seestadt Baufeld D12 · Abgabepläne' },
  { icon: MessageSquare, name: 'Abgleich Statik, Planstand Oktober', where: 'Chat · Wohnbau Seestadt Baufeld D12' },
  { icon: Folder, name: 'Fluchtwegnachweise Tiefgarage', where: 'Ordner · Wohnbau Seestadt Baufeld D12' },
]

function Row({ icon: Icon, name, where, why, picked = false }: { icon: LucideIcon; name: string; where: string; why?: string; picked?: boolean }): JSX.Element {
  return (
    <div className={`flex items-center gap-3 rounded-control px-3 py-2 ${picked ? 'bg-desk' : ''}`}>
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="text-name block truncate">{name}</span>
        <span className="text-muted-foreground text-meta block truncate">{where}</span>
      </span>
      {why && <span className="text-muted-foreground text-meta max-w-[220px] shrink-0 truncate">{why}</span>}
    </div>
  )
}

function Group({ label, count, children }: { label: string; count?: number; children: ReactNode }): JSX.Element {
  return (
    <div className="px-1.5 pt-2">
      <p className="text-muted-foreground text-meta px-3 pb-1 font-medium">
        {label}
        {count !== undefined && <span className="ml-1.5 font-normal">{count}</span>}
      </p>
      {children}
    </div>
  )
}

export function SearchWindow({ query }: { query: string }): JSX.Element {
  const typed = query !== '1'
  const chip = 'text-name rounded-full px-2.5 py-1'
  return (
    <div className="absolute inset-0 z-50 flex justify-center bg-black/30 pt-24">
      <div className="bg-background shadow-lg flex h-fit w-[660px] flex-col overflow-hidden rounded-[16px]">
        <div className="flex items-center gap-3 px-5 pt-4">
          <Search className="size-4 shrink-0" aria-hidden />
          <span className={`flex-1 text-[15px] ${typed ? '' : 'text-muted-foreground'}`}>{typed ? query : 'Dateien, Chats und Projekte finden …'}</span>
          <span className={KEY}>Esc</span>
        </div>
        <div className="border-hairline flex items-center gap-1 border-b px-4 pb-3 pt-3">
          <span className={`${chip} bg-desk font-medium`}>Alles</span>
          <span className={`${chip} text-muted-foreground`}>Dateien</span>
          <span className={`${chip} text-muted-foreground`}>Chats</span>
          <span className={`${chip} text-muted-foreground`}>Projekte</span>
          <span className="text-muted-foreground text-meta ml-auto">im ganzen Büro</span>
        </div>
        {typed ? (
          <>
            <Group label="Dateien" count={6}>
              {HITS.map((hit, index) => (
                <Row key={hit.name} {...hit} picked={index === 0} />
              ))}
            </Group>
            <Group label="Chats" count={1}>
              <Row icon={MessageSquare} name="Fluchtweglänge im Erdgeschoss" where="Chat · Wohnbau Seestadt Baufeld D12" />
            </Group>
            <div className="text-name flex items-center gap-2 px-6 pb-3 pt-2 font-medium">
              Alle 9 Treffer mit Filtern öffnen
              <ArrowRight className="size-3.5" aria-hidden />
            </div>
          </>
        ) : (
          <>
            <Group label="Zuletzt geöffnet">
              {RECENT.map((hit, index) => (
                <Row key={hit.name} {...hit} picked={index === 0} />
              ))}
            </Group>
            <div className="h-3" />
          </>
        )}
        <div className="border-hairline text-muted-foreground text-meta flex items-center gap-4 border-t px-5 py-2">
          <span>↑ ↓ wählen</span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="size-3" aria-hidden />
            öffnen
          </span>
        </div>
      </div>
    </div>
  )
}

function IconSpot({ icon: Icon, active = false, dark = false, badge }: { icon: LucideIcon; active?: boolean; dark?: boolean; badge?: number }): JSX.Element {
  return (
    <span className={`relative flex size-9 items-center justify-center rounded-control ${dark ? 'bg-primary text-primary-foreground' : active ? 'bg-sheet shadow-xs' : 'text-muted-foreground'}`}>
      <Icon className="size-4" aria-hidden />
      {badge !== undefined && <span className="bg-foreground text-background absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium">{badge}</span>}
    </span>
  )
}

function Label({ text, at }: { text: string; at: string }): JSX.Element {
  return <span className={`bg-sheet shadow-md text-meta absolute left-[60px] z-50 whitespace-nowrap rounded-control px-2 py-1 ${at}`}>{text}</span>
}

function ProfileMenu(): JSX.Element {
  const row = 'text-name flex h-9 items-center gap-2.5 rounded-control px-2.5 font-normal'
  const icon = 'text-muted-foreground size-4 shrink-0'
  return (
    <div className="bg-sheet border-hairline shadow-lg absolute bottom-3 left-[64px] z-50 w-[260px] rounded-[16px] border p-1.5">
      <div className="px-2.5 pb-2 pt-1.5">
        <p className="text-name font-medium">Anna Berger</p>
        <p className="text-muted-foreground text-meta">Musterarchitektur ZT GmbH</p>
      </div>
      <div className="bg-desk mx-1 mb-1.5 h-px" />
      <div className={row}>
        <UserRound className={icon} aria-hidden />
        Profil
      </div>
      <div className={row}>
        <BookMarked className={icon} aria-hidden />
        Mein Gedächtnis
      </div>
      <div className={row}>
        <Building2 className={icon} aria-hidden />
        Organisation
      </div>
      <div className={row}>
        <Moon className={icon} aria-hidden />
        Design umschalten
      </div>
      <div className="bg-desk mx-1 my-1.5 h-px" />
      <div className={row}>
        <LogOut className={icon} aria-hidden />
        Abmelden
      </div>
    </div>
  )
}

export function FoldedRail({ personal, show }: { personal: boolean; show: string }): JSX.Element {
  const flyout = show === 'fly'
  const ProjectIcon = useProjectIcon()
  return (
    <div className="relative z-40 flex h-full shrink-0">
      <div className="bg-desk border-hairline flex h-full w-14 flex-col items-center gap-1 border-r py-3">
        <span title="Leiste ausklappen" className="text-muted-foreground flex size-9 items-center justify-center">
          <PanelLeft className="size-4" aria-label="Leiste ausklappen" />
        </span>
        <div className="h-2" />
        <IconSpot icon={personal ? LockKeyhole : ProjectIcon} dark={personal} active={!personal} />
        <div className="bg-selected my-1 h-px w-6" />
        <IconSpot icon={SquarePen} />
        <IconSpot icon={Folder} />
        <IconSpot icon={Zap} />
        <div className="flex-1" />
        <IconSpot icon={Archive} active={show === 'office'} />
        <IconSpot icon={Bell} badge={8} active={show === 'bell'} />
        <span className="bg-sheet shadow-xs text-meta mt-1 flex size-7 items-center justify-center rounded-full font-medium">AB</span>
      </div>
      {show === 'office' && <Label text="Bürobibliothek" at="bottom-[92px]" />}
      {show === 'bell' && <InboxPopover beside />}
      {show === 'me' && <ProfileMenu />}
      {flyout && (
        <SidebarProvider className="absolute bottom-2 left-[60px] top-2 min-h-0 w-[288px]">
          <div className="bg-desk border-hairline shadow-lg flex h-full w-full flex-col overflow-hidden rounded-[16px] border p-3">
            <div className="flex items-center justify-between px-2 pb-3 pt-1">
              <span className="text-[15px] font-semibold">{identity.name}</span>
              <span className="text-muted-foreground flex items-center gap-1">
                <span className="flex size-8 items-center justify-center">
                  <Search className="size-4" aria-label="Suche" />
                </span>
                <span title="Leiste anheften" className="flex size-8 items-center justify-center">
                  <PanelLeft className="size-4" aria-label="Leiste anheften" />
                </span>
              </span>
            </div>
            <SpaceToggle personal={personal} />
            {!personal && (
              <div className="mt-1">
                <ProjectSwitcher projects={PROJECTS} activeProjectId="p-1" />
              </div>
            )}
            <SidebarMenu className="mt-3 gap-0.5">
              <NavRow icon={SquarePen} label="Neuer Chat" />
              <NavRow icon={Folder} label={personal ? 'Meine Ablage' : 'Ablage'} />
              <NavRow icon={Zap} label={personal ? 'Meine Automatisierungen' : 'Automatisierung'} />
            </SidebarMenu>
            <div className="text-muted-foreground text-meta mt-5 flex h-7 items-center px-3 font-medium">Letzte Chats</div>
            <ul className="flex flex-col gap-0.5">
              {ALL_CHATS.map((chat, index) => (
                <ChatRow key={chat.title} chat={chat} current={index === 1} showProject indent={false} />
              ))}
              <MoreRow label="Alle Chats" indent={false} />
            </ul>
          </div>
        </SidebarProvider>
      )}
    </div>
  )
}
