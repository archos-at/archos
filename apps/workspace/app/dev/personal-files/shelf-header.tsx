'use client'

// PROTOTYPE, not for merge: a calmer head for the Ablage page (concept for ticket 81).

import type { JSX } from 'react'
import { CheckSquare, Folder, FolderLock, FolderPlus, LayoutGrid, List, ListChecks, Mail, MoreHorizontal, Search, SlidersHorizontal, Trash2, Upload, type LucideIcon } from 'lucide-react'

function Side({ icon: Icon, label, who, picked }: { icon: LucideIcon; label: string; who: string; picked: boolean }): JSX.Element {
  return (
    <div className={`flex h-11 items-center gap-2.5 px-4 ${picked ? 'bg-sheet shadow-xs rounded-[8px]' : ''}`}>
      <Icon className={`size-4 shrink-0 ${picked ? '' : 'text-muted-foreground'}`} aria-hidden />
      <span className={`text-sm ${picked ? 'font-medium' : 'text-muted-foreground font-normal'}`}>{label}</span>
      <span className="text-muted-foreground text-meta ml-auto shrink-0">{who}</span>
    </div>
  )
}

function Place({ icon: Icon, label, count, current = false }: { icon: LucideIcon; label: string; count?: number; current?: boolean }): JSX.Element {
  return (
    <span className={`inline-flex h-9 items-center gap-2 border-b-2 text-sm ${current ? 'border-foreground font-medium' : 'text-muted-foreground border-transparent font-normal'}`}>
      <Icon className="size-4" aria-hidden />
      {label}
      {count !== undefined && <span className="bg-desk text-foreground text-meta rounded-full px-1.5 font-medium">{count}</span>}
    </span>
  )
}

function MoreMenu({ own }: { own: boolean }): JSX.Element {
  const row = 'text-name flex h-9 items-center gap-2.5 rounded-control px-2.5 font-normal'
  const icon = 'text-muted-foreground size-4 shrink-0'
  return (
    <div className="bg-sheet shadow-md absolute right-0 top-full z-30 mt-1.5 w-60 rounded-[16px] p-1.5">
      <div className="text-muted-foreground text-meta px-2.5 pb-1 pt-1.5 font-medium">Ansicht</div>
      <div className={`${row} bg-desk`}>
        <LayoutGrid className={icon} aria-hidden />
        Kacheln
      </div>
      <div className={row}>
        <List className={icon} aria-hidden />
        Liste
      </div>
      <div className="bg-desk mx-1 my-1.5 h-px" />
      <div className={row}>
        <SlidersHorizontal className={icon} aria-hidden />
        Filtern und sortieren
      </div>
      <div className={row}>
        <CheckSquare className={icon} aria-hidden />
        Mehrere auswählen
      </div>
      <div className={row}>
        <FolderPlus className={icon} aria-hidden />
        Ordner anlegen
      </div>
      <div className="bg-desk mx-1 my-1.5 h-px" />
      <div className={row}>
        <Trash2 className={icon} aria-hidden />
        Papierkorb
        {!own && <span className="text-muted-foreground text-meta ml-auto">2</span>}
      </div>
    </div>
  )
}

export function ShelfHeader({ own, form, moreOpen, crumb }: { own: boolean; form: string; moreOpen: boolean; crumb: string }): JSX.Element {
  const search = (
    <div className="border-field-border bg-sheet text-muted-foreground flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control border px-3 text-sm">
      <Search className="size-4 shrink-0" aria-hidden />
      {own ? 'In meiner Ablage suchen …' : 'In der Projektablage suchen …'}
    </div>
  )
  const tools = (
    <div className="relative flex shrink-0 items-center gap-2">
      <span className="bg-sheet shadow-press inline-flex h-9 items-center gap-2 rounded-control px-3 text-sm font-medium">
        <Upload className="size-4" aria-hidden />
        Hochladen
      </span>
      <span className={`flex size-9 items-center justify-center rounded-control ${moreOpen ? 'bg-selected' : 'bg-sheet shadow-press'}`}>
        <MoreHorizontal className="size-4" aria-label="Mehr" />
      </span>
      {moreOpen && <MoreMenu own={own} />}
    </div>
  )
  const places = (
    <div className="flex items-center gap-6">
      <Place icon={Folder} label="Ordner" current />
      {!own && <Place icon={Mail} label="E-Mail-Eingang" count={3} />}
      {!own && <Place icon={ListChecks} label="Offene Punkte" />}
    </div>
  )
  return (
    <header className="border-hairline flex flex-col gap-4 border-b px-8 pb-0 pt-3">
      <div>
        <span className="text-muted-foreground text-meta">{crumb}</span>
        <h1 className="text-page-title">Ablage</h1>
      </div>
      <div className="bg-desk grid max-w-[620px] grid-cols-2 rounded-[10px] p-1">
        <Side icon={Folder} label="Projektablage" who="Team" picked={!own} />
        <Side icon={FolderLock} label="Meine Ablage" who="Nur Sie" picked={own} />
      </div>
      {form === 'search' ? (
        <>
          <div className="flex items-center gap-2">
            {search}
            {tools}
          </div>
          {places}
        </>
      ) : (
        <div className="flex items-end justify-between gap-6">
          {places}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 pb-2">
            <div className="max-w-[280px] flex-1">{search}</div>
            {tools}
          </div>
        </div>
      )}
    </header>
  )
}
