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

function MoreMenu(): JSX.Element {
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
        <FolderPlus className={icon} aria-hidden />
        Ordner anlegen
      </div>
    </div>
  )
}

export function ShelfHeader({ own, form, moreOpen, crumb, trashOpen = false }: { own: boolean; form: string; moreOpen: boolean; crumb: string; trashOpen?: boolean }): JSX.Element {
  const search = (
    <div className="border-field-border bg-sheet text-muted-foreground flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control border px-3 text-sm">
      <Search className="size-4 shrink-0" aria-hidden />
      {own ? 'In meiner Ablage suchen …' : 'In der Projektablage suchen …'}
    </div>
  )
  const tools = (
    <div className="relative flex shrink-0 items-center gap-2">
      <span className="bg-sheet shadow-press inline-flex h-9 items-center gap-2 rounded-control px-3 text-sm font-medium">
        <CheckSquare className="size-4" aria-hidden />
        Auswählen
      </span>
      <span title="Papierkorb" className={`relative flex size-9 items-center justify-center rounded-control ${trashOpen ? 'bg-selected' : 'bg-sheet shadow-press'}`}>
        <Trash2 className="size-4" aria-label="Papierkorb" />
        {!own && <span className="bg-foreground text-background text-meta absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-medium">2</span>}
      </span>
      <span className="bg-sheet shadow-press inline-flex h-9 items-center gap-2 rounded-control px-3 text-sm font-medium">
        <Upload className="size-4" aria-hidden />
        Hochladen
      </span>
      <span className={`flex size-9 items-center justify-center rounded-control ${moreOpen ? 'bg-selected' : 'bg-sheet shadow-press'}`}>
        <MoreHorizontal className="size-4" aria-label="Mehr" />
      </span>
      {moreOpen && <MoreMenu />}
    </div>
  )
  const places = (
    <div className="flex items-center gap-6">
      <Place icon={Folder} label="Dateien" current />
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
          <div className={`flex items-center gap-2 ${own ? 'pb-4' : ''}`}>
            {search}
            {tools}
          </div>
          {!own && places}
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

const DELETED = [
  { name: 'Grundriss_EG_Index-A.pdf', where: 'Abgabepläne', who: 'Ihnen', when: 'vor 2 Tagen', left: 'noch 12 Tage' },
  { name: 'Besprechungsnotiz_alt.pdf', where: 'sonstiges', who: 'Jakob Huber', when: 'vor 9 Tagen', left: 'noch 5 Tage' },
]

export function TrashWindow(): JSX.Element {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[rgb(15_14_13_/_0.4)] p-8">
      <div className="bg-background shadow-lg flex w-full max-w-[680px] flex-col rounded-[16px]">
        <header className="flex items-start justify-between gap-4 px-6 pb-3 pt-5">
          <div>
            <h2 className="text-page-title">Papierkorb</h2>
            <p className="text-muted-foreground mt-1 text-sm">Gelöschte Dateien der Projektablage. Nach 14 Tagen werden sie endgültig entfernt.</p>
          </div>
          <span className="text-muted-foreground text-name mt-1 font-medium">Schließen</span>
        </header>
        <div className="border-hairline border-t">
          {DELETED.map((file) => (
            <div key={file.name} className="border-hairline flex items-center gap-3 border-b px-6 py-3">
              <span className="bg-desk flex size-8 shrink-0 items-center justify-center rounded-control">
                <Folder className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-name truncate">{file.name}</p>
                <p className="text-muted-foreground text-meta truncate">
                  Aus „{file.where}“ · gelöscht von {file.who} {file.when} · {file.left}
                </p>
              </div>
              <span className="bg-sheet shadow-press text-name inline-flex h-8 shrink-0 items-center rounded-control px-3 font-medium">Wiederherstellen</span>
            </div>
          ))}
        </div>
        <footer className="flex items-center justify-between px-6 py-4">
          <span className="text-muted-foreground text-meta">2 Dateien</span>
          <span className="text-destructive text-name font-medium">Papierkorb leeren</span>
        </footer>
      </div>
    </div>
  )
}
