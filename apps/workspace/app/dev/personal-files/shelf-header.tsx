'use client'

// PROTOTYPE, not for merge: a calmer head for the Ablage page (concept for ticket 81).

import { useSearchParams } from 'next/navigation'
import type { JSX } from 'react'
import { UsersRound, LockKeyhole, X, FileText, ArrowLeft, CheckSquare, ChevronRight, Folder, FolderLock, FolderPlus, LayoutGrid, List, ListChecks, Mail, MoreHorizontal, Search, SlidersHorizontal, Sparkles, Trash2, Upload, type LucideIcon } from 'lucide-react'

function Side({ icon: Icon, label, who, picked, faded = false }: { icon: LucideIcon; label: string; who: string; picked: boolean; faded?: boolean }): JSX.Element {
  return (
    <div className={`flex h-11 items-center gap-2.5 px-4 ${picked ? 'bg-sheet shadow-xs rounded-[8px]' : ''} ${faded ? 'opacity-50' : ''}`}>
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

export function Who({ own }: { own: boolean }): JSX.Element {
  const Icon = own ? LockKeyhole : UsersRound
  return (
    <span className="text-muted-foreground text-name mb-1 inline-flex items-center gap-1.5">
      <Icon className="size-3.5" aria-hidden />
      {own ? 'Nur Sie' : 'Projektteam'}
    </span>
  )
}

function WhoPill({ own }: { own: boolean }): JSX.Element {
  return (
    <span className="bg-sheet shadow-press text-name mb-0.5 inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 font-medium">
      {own ? (
        <>
          <LockKeyhole className="size-3.5" aria-hidden />
          Nur Sie
        </>
      ) : (
        <>
          <span className="flex -space-x-1.5">
            {['AB', 'FH', 'MH'].map((name, index) => (
              <span key={name} className={`text-meta ring-sheet flex size-5 items-center justify-center rounded-full text-[9px] font-medium ring-2 ${['bg-[#f3dede]', 'bg-[#efe6cf]', 'bg-[#dfe7ef]'][index]}`}>{name}</span>
            ))}
          </span>
          6 im Projekt
        </>
      )}
    </span>
  )
}

export function ShelfHeader({ own, form, moreOpen, crumb, trashOpen = false, office, query, noProject = false, alone = false, plainTitle = false }: { own: boolean; form: string; moreOpen: boolean; crumb: string; trashOpen?: boolean; office?: string; query?: string; noProject?: boolean; alone?: boolean; plainTitle?: boolean }): JSX.Element {
  const who = useSearchParams()?.get('who')
  const search = (
    <div className={`bg-sheet flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control border px-3 text-sm ${query ? 'border-foreground' : 'border-field-border text-muted-foreground'}`}>
      <Search className="size-4 shrink-0" aria-hidden />
      {query ? (
        <>
          <span className="flex-1">{query}</span>
          <X className="text-muted-foreground size-4" aria-label="Suche leeren" />
        </>
      ) : office ? `In „${office}“ suchen …` : own ? 'In meiner Ablage suchen …' : 'In der Projektablage suchen …'}
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
      <div className="flex items-end justify-between gap-4">
        <div>
          <span className="text-muted-foreground text-meta">{crumb}{who === 'c' ? (own ? ' · Nur Sie' : ' · Projektteam') : ''}</span>
          <h1 className="text-page-title">{office ?? (alone && own && !plainTitle ? 'Meine Ablage' : 'Ablage')}</h1>
          {alone && who === 'b' && <p className="text-muted-foreground mt-1 text-sm">{own ? 'Nur Sie sehen diese Ablage.' : 'Alle im Projekt sehen diese Ablage.'}</p>}
        </div>
        {alone && !who && <Who own={own} />}
        {alone && who === 'd' && <WhoPill own={own} />}
      </div>
      {!office && !alone && (
        <div className="bg-desk grid max-w-[620px] grid-cols-2 rounded-[10px] p-1">
          <Side icon={Folder} label="Projektablage" who={noProject ? 'Kein Projekt' : 'Team'} picked={!own} faded={noProject} />
          <Side icon={FolderLock} label="Meine Ablage" who="Nur Sie" picked={own} />
        </div>
      )}
      {form === 'search' ? (
        <>
          <div className={`flex items-center gap-2 ${own || office ? 'pb-4' : ''}`}>
            {search}
            {tools}
          </div>
          {!own && !office && places}
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

export function FolderPath({ trail, name }: { trail: string[]; name: string }): JSX.Element {
  const shown = trail.length > 3 ? [trail[0]!, '…', trail[trail.length - 1]!] : trail
  return (
    <div className="border-hairline mx-8 flex h-11 items-center gap-2 border-b">
      {trail.length > 0 && (
        <span title={`Zurück zu ${trail[trail.length - 1]}`} className="text-muted-foreground hover:bg-desk -ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-control">
          <ArrowLeft className="size-4" aria-label="Eine Ebene zurück" />
        </span>
      )}
      <nav aria-label="Pfad" className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[13px]">
        {shown.map((step, index) => (
          <span key={`${step}-${index}`} className="flex shrink-0 items-center gap-1.5">
            <span>{step}</span>
            <ChevronRight className="size-3" aria-hidden />
          </span>
        ))}
        <span className="text-foreground min-w-0 truncate font-medium">{name}</span>
      </nav>
    </div>
  )
}

export function ReadStatus({ text, open }: { text: string; open?: string }): JSX.Element {
  return (
    <p className="text-muted-foreground text-meta flex items-center gap-1.5 px-8 pb-8 pt-2">
      <Sparkles className="size-3.5" aria-hidden />
      {text}
      {open && <span className="text-foreground font-medium underline underline-offset-2">{open}</span>}
    </p>
  )
}

export function UnreadHint({ count }: { count: number }): JSX.Element {
  return (
    <p className="mx-8 mt-4 flex items-center gap-2 rounded-control bg-[#f6ecd6] px-3 py-2 text-[13px] text-[#8a5a00]">
      <Sparkles className="size-3.5 shrink-0" aria-hidden />
      {count} Dokumente konnten nicht gelesen werden.
      <span className="font-medium underline underline-offset-2">Ansehen</span>
    </p>
  )
}

const HITS = [
  { name: 'Brandschutzkonzept_Wohnhausanlage_Index-D.pdf', path: 'Abgabepläne › Fluchtwegnachweise Tiefgarage', why: 'im Namen' },
  { name: 'Brandschutzkonzept_Index-C.pdf', path: 'Abgabepläne › Archiv', why: 'im Namen' },
  { name: 'Besprechung_Brandschutzplaner_2026-10-14.pdf', path: 'Berichte', why: 'im Namen' },
  { name: 'Grundriss_EG_Index-C.pdf', path: 'Abgabepläne', why: 'im Inhalt: „Brandschutztür T30 zum Stiegenhaus“' },
  { name: 'Baubeschreibung.pdf', path: 'Grundlagen', why: 'im Inhalt: „Brandschutz gemäß OIB-Richtlinie 2“' },
]

export function SearchHits({ query }: { query: string }): JSX.Element {
  return (
    <div className="px-8 py-5">
      <p className="text-muted-foreground text-meta">
        {HITS.length} Treffer für „{query}“ in der Projektablage, auch aus Unterordnern
      </p>
      <ul className="bg-sheet shadow-sm mt-3 rounded-[10px]">
        {HITS.map((hit, index) => (
          <li key={hit.name} className={`flex items-center gap-3 px-4 py-3 ${index > 0 ? 'border-hairline border-t' : ''}`}>
            <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-name truncate">{hit.name}</p>
              <p className="text-muted-foreground text-meta truncate">{hit.path}</p>
            </div>
            <span className="text-muted-foreground text-meta shrink-0">{hit.why}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
