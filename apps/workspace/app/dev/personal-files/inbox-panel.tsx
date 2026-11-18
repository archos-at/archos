'use client'

// PROTOTYPE, not for merge: a reworked Postfach panel for the personal-area concept (ticket 81).

import type { JSX } from 'react'
import { ArrowRight, AtSign, Bell, CheckCheck, ChevronDown, CircleHelp, ClipboardCheck, FolderInput, X, type LucideIcon } from 'lucide-react'

interface Entry {
  kind: 'task' | 'question' | 'mention' | 'proposal' | 'news'
  waiting: boolean
  title: string
  from: string
  where?: string
  project: string | null
  due?: { label: string; tone: 'late' | 'soon' | 'plain' }
}

const KIND: Record<Entry['kind'], { icon: LucideIcon; label: string }> = {
  task: { icon: ClipboardCheck, label: 'Aufgaben' },
  question: { icon: CircleHelp, label: 'Fragen' },
  mention: { icon: AtSign, label: 'Erwähnungen' },
  proposal: { icon: FolderInput, label: 'Vorschläge' },
  news: { icon: Bell, label: 'Neuigkeiten' },
}

const A = 'Volksschule Am Hang'
const B = 'Wohnanlage Linzer Straße'
const ENTRIES: Entry[] = [
  { kind: 'task', waiting: true, title: 'Brüstungshöhe im 2. OG unter 1,00 m.', from: 'Ihnen zugewiesen', where: 'Schnitt A-A', project: A, due: { label: 'Überfällig', tone: 'late' } },
  { kind: 'question', waiting: true, title: 'Gilt für die Brüstung die Höhe ab Fertigfußboden oder ab Rohdecke?', from: 'Der Agent fragt Sie', where: 'Schnitt A-A', project: A },
  { kind: 'task', waiting: true, title: 'Fluchtwegbreite im Gang nachweisen.', from: 'Ihnen zugewiesen', where: 'Grundriss EG', project: B, due: { label: 'Bald fällig', tone: 'soon' } },
  { kind: 'task', waiting: true, title: 'Brandschutztür T30 zum Stiegenhaus fehlt in der Legende.', from: 'Von Anna Weber', where: 'Grundriss EG', project: B, due: { label: '24. Okt.', tone: 'plain' } },
  { kind: 'mention', waiting: true, title: 'Passt die Brüstungshöhe im Zimmer 1 zur Einreichung?', from: 'Jakob Huber hat Sie erwähnt', where: 'Grundriss EG', project: B },
  { kind: 'proposal', waiting: true, title: 'Neuer Ablageort für 5 Dateien', from: 'Vorschlag des Agenten', where: 'Ablage', project: B },
  { kind: 'question', waiting: true, title: 'Reicht das Nutzungsbudget für diesen Monat?', from: 'Anna Weber bittet um Ihre Einschätzung', where: 'Chat', project: null },
  { kind: 'news', waiting: false, title: 'Neue Fassung von „Grundriss EG Index B“ hochgeladen', from: 'Sabine Gruber', where: '4 offene Anmerkungen', project: B },
  { kind: 'news', waiting: false, title: 'Anmerkung 3 in „Schnitt A-A“ wurde erledigt', from: 'Jakob Huber', project: A },
  { kind: 'news', waiting: false, title: 'Das Nutzungsbudget ist zu 80 % aufgebraucht', from: 'Ihr Büro', project: null },
  { kind: 'news', waiting: false, title: 'Maria Huber hat Feedback gesendet', from: 'Maria Huber', project: null },
]

const TONE = { late: 'bg-[rgb(193_74_56_/_0.12)] text-destructive', soon: 'bg-[#f6ecd6] text-[#8a5a00]', plain: 'bg-desk text-muted-foreground' }
const NO_PROJECT = 'Ohne Projekt'

function Row({ entry }: { entry: Entry }): JSX.Element {
  const Icon = KIND[entry.kind].icon
  return (
    <div className="border-hairline flex gap-3 border-b px-4 py-3 last:border-b-0">
      <span className="bg-desk mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-control">
        <Icon className="size-3.5" aria-label={KIND[entry.kind].label} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className={`text-name line-clamp-2 min-w-0 flex-1 ${entry.waiting ? '' : 'font-normal'}`}>{entry.title}</p>
          {entry.due && <span className={`text-meta shrink-0 rounded-full px-2 py-0.5 font-medium ${TONE[entry.due.tone]}`}>{entry.due.label}</span>}
        </div>
        <p className="text-muted-foreground text-meta mt-0.5 truncate">{[entry.from, entry.where].filter(Boolean).join(' · ')}</p>
      </div>
    </div>
  )
}

function Groups({ entries }: { entries: Entry[] }): JSX.Element {
  const names = [...new Set(entries.map((entry) => entry.project ?? NO_PROJECT))].sort((x, y) => Number(x === NO_PROJECT) - Number(y === NO_PROJECT))
  return (
    <>
      {names.map((name) => (
        <div key={name}>
          <h4 className="text-muted-foreground text-meta px-4 pb-1 pt-3 font-medium">{name}</h4>
          {entries.filter((entry) => (entry.project ?? NO_PROJECT) === name).map((entry) => <Row key={entry.title} entry={entry} />)}
        </div>
      ))}
    </>
  )
}

function Part({ title, note, entries }: { title: string; note?: string; entries: Entry[] }): JSX.Element {
  return (
    <section>
      <h3 className="bg-desk flex items-baseline gap-2 px-4 py-2 text-[13px] font-medium">
        {title}
        <span className="text-muted-foreground font-normal">{entries.length}</span>
        {note && <span className="text-destructive text-meta font-medium">{note}</span>}
      </h3>
      <Groups entries={entries} />
    </section>
  )
}

const waiting = ENTRIES.filter((entry) => entry.waiting)
const news = ENTRIES.filter((entry) => !entry.waiting)

export function InboxPanel(): JSX.Element {
  return (
    <aside className="bg-background border-hairline flex h-full w-[400px] shrink-0 flex-col border-r">
      <header className="flex items-center justify-between px-4 pb-3 pt-4">
        <h2 className="text-pane-title">Postfach</h2>
        <X className="text-muted-foreground size-4" aria-label="Schließen" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Part title="Wartet auf Sie" note="1 überfällig" entries={waiting} />
        <Part title="Neuigkeiten" entries={news} />
      </div>
      <footer className="text-muted-foreground text-meta border-hairline flex items-center justify-between border-t px-4 py-3 font-medium">
        Alle Einträge, auch archivierte
        <ArrowRight className="size-3.5" aria-hidden />
      </footer>
    </aside>
  )
}

export function InboxAll(): JSX.Element {
  const tab = 'px-3 py-1.5'
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[rgb(15_14_13_/_0.4)] p-8">
      <div className="bg-background shadow-lg flex h-[720px] w-full max-w-[760px] flex-col rounded-[16px]">
        <header className="flex items-center justify-between gap-4 px-6 pb-4 pt-5">
          <h2 className="text-page-title">Postfach</h2>
          <X className="text-muted-foreground size-4" aria-label="Schließen" />
        </header>
        <div className="flex items-center justify-between gap-3 px-6 pb-3">
          <div className="bg-desk text-name flex rounded-control p-0.5 font-medium">
            <span className={`${tab} text-muted-foreground`}>Wartet auf Sie 7</span>
            <span className={`${tab} bg-sheet shadow-xs rounded-[4px]`}>Alle</span>
            <span className={`${tab} text-muted-foreground`}>Archiviert</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="shadow-press text-name inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 font-medium">
              Alle Projekte
              <ChevronDown className="size-3.5" aria-hidden />
            </span>
            <span className="text-muted-foreground text-name inline-flex h-8 items-center gap-1.5 px-1 font-medium">
              <CheckCheck className="size-4" aria-hidden />
              Alle gelesen
            </span>
          </div>
        </div>
        <div className="border-hairline min-h-0 flex-1 overflow-hidden border-t">
          <Groups entries={ENTRIES} />
        </div>
      </div>
    </div>
  )
}
