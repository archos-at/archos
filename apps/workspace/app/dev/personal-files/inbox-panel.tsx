'use client'

// PROTOTYPE, not for merge: a reworked Postfach panel for the personal-area concept (ticket 81).

import type { JSX } from 'react'
import { AtSign, CircleHelp, ClipboardCheck, FolderInput, X, type LucideIcon } from 'lucide-react'

interface Entry {
  kind: 'task' | 'question' | 'mention' | 'proposal'
  title: string
  from: string
  where: string
  project: string
  due?: { label: string; tone: 'late' | 'soon' | 'plain' }
}

const KIND: Record<Entry['kind'], { icon: LucideIcon; label: string }> = {
  task: { icon: ClipboardCheck, label: 'Aufgaben' },
  question: { icon: CircleHelp, label: 'Fragen' },
  mention: { icon: AtSign, label: 'Erwähnungen' },
  proposal: { icon: FolderInput, label: 'Vorschläge' },
}

const ENTRIES: Entry[] = [
  { kind: 'task', title: 'Brüstungshöhe im 2. OG unter 1,00 m.', from: 'Ihnen zugewiesen', where: 'Schnitt A-A', project: 'Volksschule Am Hang', due: { label: 'Überfällig', tone: 'late' } },
  { kind: 'task', title: 'Fluchtwegbreite im Gang nachweisen.', from: 'Ihnen zugewiesen', where: 'Grundriss EG', project: 'Wohnanlage Linzer Straße', due: { label: 'Bald fällig', tone: 'soon' } },
  { kind: 'task', title: 'Brandschutztür T30 zum Stiegenhaus fehlt in der Legende.', from: 'Von Anna Weber', where: 'Grundriss EG', project: 'Wohnanlage Linzer Straße', due: { label: '24. Okt.', tone: 'plain' } },
  { kind: 'question', title: 'Gilt für die Brüstung die Höhe ab Fertigfußboden oder ab Rohdecke?', from: 'Der Agent fragt Sie', where: 'Schnitt A-A', project: 'Volksschule Am Hang' },
  { kind: 'task', title: 'Schachtquerschnitt mit der Haustechnik abstimmen.', from: 'Von Anna Weber', where: 'Grundriss EG', project: 'Wohnanlage Linzer Straße' },
  { kind: 'mention', title: 'Passt die Brüstungshöhe im Zimmer 1 zur Einreichung?', from: 'Jakob Huber hat Sie erwähnt', where: 'Grundriss EG', project: 'Wohnanlage Linzer Straße' },
  { kind: 'proposal', title: 'Neuer Ablageort für 5 Dateien', from: 'Vorschlag des Agenten', where: 'Ablage', project: 'Wohnanlage Linzer Straße' },
  { kind: 'question', title: 'Ist die Annahme richtig, dass das Atrium als eigener Brandabschnitt geführt wird?', from: 'Anna Weber bittet um Ihre Einschätzung', where: 'Chat', project: 'Volksschule Am Hang' },
]

const TONE = { late: 'bg-[rgb(193_74_56_/_0.12)] text-destructive', soon: 'bg-[#f6ecd6] text-[#8a5a00]', plain: 'bg-desk text-muted-foreground' }

function Row({ entry, showProject }: { entry: Entry; showProject: boolean }): JSX.Element {
  const Icon = KIND[entry.kind].icon
  return (
    <div className="border-hairline flex gap-3 border-b px-4 py-3 last:border-b-0">
      <span className="bg-desk mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-control">
        <Icon className="size-3.5" aria-label={KIND[entry.kind].label} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="text-name line-clamp-2 min-w-0 flex-1">{entry.title}</p>
          {entry.due && <span className={`text-meta shrink-0 rounded-full px-2 py-0.5 font-medium ${TONE[entry.due.tone]}`}>{entry.due.label}</span>}
        </div>
        <p className="text-muted-foreground text-meta mt-0.5 truncate">
          {entry.from} · {entry.where}
          {showProject && ` · ${entry.project}`}
        </p>
      </div>
    </div>
  )
}

function Section({ title, count, entries, showProject }: { title: string; count: number; entries: Entry[]; showProject: boolean }): JSX.Element {
  return (
    <section>
      <h3 className="text-muted-foreground text-meta bg-desk flex items-center gap-2 px-4 py-1.5 font-medium">
        {title}
        <span className="font-normal">{count}</span>
      </h3>
      {entries.map((entry) => (
        <Row key={entry.title} entry={entry} showProject={showProject} />
      ))}
    </section>
  )
}

export function InboxPanel({ group }: { group: string }): JSX.Element {
  const byProject = group === 'project'
  const projects = [...new Set(ENTRIES.map((entry) => entry.project))]
  const dated = ENTRIES.filter((entry) => entry.due)
  const open = ENTRIES.filter((entry) => !entry.due)
  return (
    <aside className="bg-background border-hairline flex h-full w-[400px] shrink-0 flex-col border-r">
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="text-pane-title">Postfach</h2>
        <X className="text-muted-foreground size-4" aria-label="Schließen" />
      </header>
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        <span className="bg-selected text-meta inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium">Alle 8</span>
        {(Object.keys(KIND) as Entry['kind'][]).map((kind) => (
          <span key={kind} className="bg-desk text-muted-foreground text-meta inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium">
            {KIND[kind].label} {ENTRIES.filter((entry) => entry.kind === kind).length}
          </span>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {byProject ? (
          projects.map((project) => <Section key={project} title={project} count={ENTRIES.filter((entry) => entry.project === project).length} entries={ENTRIES.filter((entry) => entry.project === project)} showProject={false} />)
        ) : (
          <>
            <Section title="Mit Frist" count={dated.length} entries={dated} showProject />
            <Section title="Ohne Frist" count={open.length} entries={open} showProject />
          </>
        )}
      </div>
      <footer className="text-muted-foreground text-meta border-hairline border-t px-4 py-3 font-medium">Alle Einträge, auch archivierte</footer>
    </aside>
  )
}
