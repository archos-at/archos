'use client'

// PROTOTYPE, not for merge: chats the agent opened versus chats a person began (concept for ticket 81).

import type { JSX } from 'react'
import { ArrowUp, ClipboardCheck, CircleHelp, Paperclip, FileText, Search, Users, X, Zap, type LucideIcon } from 'lucide-react'

import identity from '@/shared/brand/identity.json'
import { ChatHeader } from '../personal-area-rail/prototype'

type Row = { title: string; project?: string; when: string; origin?: { icon: LucideIcon; label: string }; shared?: boolean }
const AUTO = { icon: Zap, label: 'Automatisierung' }
const ASK = { icon: CircleHelp, label: 'Rückfrage' }
const CHECK = { icon: ClipboardCheck, label: 'Abgleich' }
const DOC = { icon: FileText, label: 'Zum Dokument' }

export const MIXED: Row[] = [
  { title: 'Wöchentlicher Brandschutz-Abgleich', project: 'Seestadt D12', when: 'vor 10 Min.', origin: AUTO },
  { title: 'Gilt für die Brüstung die Höhe ab Fertigfußboden?', project: 'Volksschule', when: 'vor 1 Std.', origin: ASK },
  { title: 'Fluchtweglänge im Erdgeschoss', project: 'Seestadt D12', when: 'vor 2 Std.' },
  { title: 'Abgleich: Grundriss_EG_Index-C.pdf', project: 'Seestadt D12', when: 'gestern', origin: CHECK },
  { title: 'Wöchentlicher Brandschutz-Abgleich', project: 'Seestadt D12', when: 'vor 7 Tagen', origin: AUTO },
  { title: 'Rampenneigung Tiefgarage', when: 'vor 3 Tagen' },
  { title: 'Brandschutzkonzept_Index-D.pdf', project: 'Seestadt D12', when: 'vor 4 Tagen', origin: DOC },
  { title: 'Abgleich Statik, Planstand Oktober', project: 'Seestadt D12', when: 'vor 5 Tagen', shared: true },
]

export function MixedList(): JSX.Element {
  return (
    <ul className="flex flex-col gap-0.5">
      {MIXED.slice(0, 6).map((row, index) => (
        <li key={`${row.title}-${index}`} className="text-muted-foreground flex h-8 items-center gap-2 rounded-control px-3 text-[13px]">
          <span className="min-w-0 flex-1 truncate">{row.title}</span>
          {row.project && <span className="text-meta max-w-[84px] shrink-0 truncate">{row.project}</span>}
        </li>
      ))}
    </ul>
  )
}

export function AllChats({ filter }: { filter: string }): JSX.Element {
  const rows = filter === 'agent' ? MIXED.filter((row) => row.origin) : filter === 'mine' ? MIXED.filter((row) => !row.origin) : MIXED
  const chip = 'text-name inline-flex items-center gap-1.5 rounded-full px-2.5 py-1'
  const count = 'text-meta rounded-full px-1.5 font-medium'
  const tab = (key: string, label: string, n: number): JSX.Element => (
    <span className={`${chip} ${filter === key ? 'bg-desk font-medium' : 'text-muted-foreground'}`}>
      {label} <span className={`${count} ${filter === key ? 'bg-sheet' : 'bg-desk text-foreground'}`}>{n}</span>
    </span>
  )
  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center bg-black/30 pt-16">
      <div className="bg-background shadow-lg flex max-h-[680px] w-[760px] flex-col overflow-hidden rounded-[16px]">
        <div className="flex items-center gap-3 px-5 pt-4">
          <p className="text-pane-title flex-1">Alle Chats</p>
          <X className="text-muted-foreground size-4" aria-label="Schließen" />
        </div>
        <div className="px-5 pt-3">
          <div className="border-field-border bg-sheet text-muted-foreground flex h-9 items-center gap-2 rounded-control border px-3 text-sm">
            <Search className="size-4" aria-hidden />
            In Chats suchen …
          </div>
        </div>
        <div className="border-hairline flex items-center gap-1 border-b px-4 pb-3 pt-3">
          {tab('mine', 'Meine Gespräche', 3)}
          {tab('agent', `Von ${identity.name} angelegt`, 5)}
          {tab('all', 'Alle', 8)}
        </div>
        <div className="min-h-0 flex-1 px-2 py-2">
          {rows.map((row, index) => {
            const Icon = row.origin?.icon
            return (
              <div key={`${row.title}-${index}`} className={`flex items-center gap-3 rounded-control px-3 py-2 ${index === 0 ? 'bg-desk' : ''}`}>
                <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">{Icon ? <Icon className="size-4" aria-hidden /> : row.shared ? <Users className="size-4" aria-hidden /> : null}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-name block truncate">{row.title}</span>
                  <span className="text-muted-foreground text-meta block truncate">
                    {row.origin ? `${row.origin.label} · ` : ''}
                    {row.project ?? 'Persönlich'}
                  </span>
                </span>
                <span className="text-muted-foreground text-meta shrink-0">{row.when}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function OriginLine({ answered }: { answered: boolean }): JSX.Element {
  return (
    <p className="text-muted-foreground text-meta mx-auto flex w-full max-w-2xl items-center gap-2 px-8 pt-1">
      <Zap className="size-3.5" aria-hidden />
      {answered ? (
        <>Aus der Automatisierung „Wöchentlicher Brandschutz-Abgleich“. Seit Ihrer Antwort steht der Chat unter „Letzte Chats“.</>
      ) : (
        <>
          Von {identity.name} angelegt, aus der Automatisierung „Wöchentlicher Brandschutz-Abgleich“. Steht nicht unter „Letzte Chats“, solange Sie nicht antworten.
          <span className="text-foreground font-medium underline underline-offset-2">Zur Automatisierung</span>
        </>
      )}
    </p>
  )
}

export function OriginChat({ answered }: { answered: boolean }): JSX.Element {
  const bar = 'bg-selected h-2 rounded'
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatHeader title="Wöchentlicher Brandschutz-Abgleich" />
      <OriginLine answered={answered} />
      <div className="mx-auto mt-6 flex w-full max-w-2xl flex-1 flex-col gap-5 px-8">
        <div className="flex max-w-[90%] flex-col gap-2.5">
          <p className="text-name font-medium">Abgleich vom 17.11.2026: zwei Abweichungen gefunden.</p>
          <div className={`${bar} w-[96%]`} />
          <div className={`${bar} w-[88%]`} />
          <div className={`${bar} w-[92%]`} />
          <div className={`${bar} w-[61%]`} />
        </div>
        {answered && (
          <>
            <div className="bg-desk text-name max-w-[80%] self-end rounded-[16px] px-3 py-2 font-normal">Welche der beiden Abweichungen ist für die Einreichung kritisch?</div>
            <div className="flex max-w-[90%] flex-col gap-2.5">
              <div className={`${bar} w-[90%]`} />
              <div className={`${bar} w-[70%]`} />
            </div>
          </>
        )}
      </div>
      <div className="mx-auto mb-6 w-full max-w-2xl px-8">
        <div className="bg-sheet border-field-border flex flex-col gap-3 rounded-[10px] border p-3">
          <span className="text-muted-foreground text-sm">Frage stellen …</span>
          <div className="flex items-center justify-between">
            <Paperclip className="size-4" aria-hidden />
            <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-control opacity-80">
              <ArrowUp className="size-4" aria-hidden />
            </span>
          </div>
        </div>
        <p className="text-muted-foreground text-meta pt-2 text-center">{identity.name} ist ein KI-System — Antworten können falsch sein; prüfen Sie sie anhand der zitierten Unterlagen.</p>
      </div>
    </main>
  )
}
