'use client'

// PROTOTYPE, not for merge: files between a chat and the shelves, step by step (concept for ticket 81).

import type { JSX, ReactNode } from 'react'
import { Archive, ArrowUp, Check, ChevronRight, FileText, FileUp, Folder, FolderInput, Hash, LockKeyhole, Paperclip, Search, Sparkles, Users, X, type LucideIcon } from 'lucide-react'

import identity from '@/shared/brand/identity.json'
import { ChatHeader } from '../personal-area-rail/prototype'

const PROJECT = 'Wohnbau Seestadt Baufeld D12'
const CARD = 'bg-sheet shadow-md rounded-[16px]'
const ROW = 'text-name flex h-9 items-center gap-2.5 rounded-control px-2.5 font-normal'
const ICON = 'text-muted-foreground size-4 shrink-0'

type Origin = 'chat' | 'project' | 'own' | 'office'
const ORIGIN: Record<Origin, { icon: LucideIcon; label: string }> = {
  chat: { icon: Paperclip, label: 'Nur in diesem Chat' },
  project: { icon: Users, label: 'Ablage des Projekts' },
  own: { icon: LockKeyhole, label: 'Meine Ablage' },
  office: { icon: Archive, label: 'Bürobibliothek' },
}

function FileChip({ name, origin, path, action, close = false }: { name: string; origin: Origin; path?: string; action?: ReactNode; close?: boolean }): JSX.Element {
  const Mark = ORIGIN[origin].icon
  return (
    <span className="bg-sheet shadow-xs relative inline-flex items-center gap-2.5 rounded-[10px] py-1.5 pl-2.5 pr-3">
      <FileText className={ICON} aria-hidden />
      <span className="min-w-0">
        <span className="text-name block truncate">{name}</span>
        <span className="text-muted-foreground text-meta flex items-center gap-1">
          <Mark className="size-3" aria-hidden />
          {ORIGIN[origin].label}
          {path ? ` › ${path}` : ''}
        </span>
      </span>
      {action}
      {close && <X className="text-muted-foreground ml-1 size-3.5" aria-label="Entfernen" />}
    </span>
  )
}

function Menu({ children, at }: { children: ReactNode; at: string }): JSX.Element {
  return <div className={`${CARD} absolute z-30 p-1.5 ${at}`}>{children}</div>
}

function Composer({ chips, note, menu, typed }: { chips?: ReactNode; note?: ReactNode; menu?: ReactNode; typed?: string }): JSX.Element {
  return (
    <div className="mx-auto mb-6 w-full max-w-2xl px-8">
      <div className="bg-sheet border-field-border relative flex flex-col gap-3 rounded-[10px] border p-3">
        {chips && <div className="flex flex-wrap gap-2">{chips}</div>}
        {note}
        <span className={`text-sm ${typed ? '' : 'text-muted-foreground'}`}>{typed ?? 'Frage stellen …'}</span>
        <div className="flex items-center justify-between">
          <span className={`flex size-8 items-center justify-center rounded-control ${menu ? 'bg-selected' : ''}`}>
            <Paperclip className="size-4" aria-label="Datei anhängen" />
          </span>
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-control opacity-80">
            <ArrowUp className="size-4" aria-hidden />
          </span>
        </div>
        {menu}
      </div>
      <p className="text-muted-foreground text-meta pt-2 text-center">{identity.name} ist ein KI-System — Antworten können falsch sein; prüfen Sie sie anhand der zitierten Unterlagen.</p>
    </div>
  )
}

function AttachMenu({ personal }: { personal: boolean }): JSX.Element {
  return (
    <Menu at="bottom-14 left-2 w-72">
      <div className={`${ROW} bg-desk`}>
        <FileUp className={ICON} aria-hidden />
        Vom Computer hochladen
      </div>
      <div className="bg-desk mx-1 my-1.5 h-px" />
      <div className="text-muted-foreground text-meta px-2.5 pb-1 pt-1 font-medium">Schon abgelegt</div>
      {!personal && (
        <div className={ROW}>
          <Users className={ICON} aria-hidden />
          Aus der Ablage des Projekts
        </div>
      )}
      <div className={ROW}>
        <LockKeyhole className={ICON} aria-hidden />
        Aus meiner Ablage
      </div>
      {personal && (
        <div className={ROW}>
          <Users className={ICON} aria-hidden />
          Aus einem Projekt …
          <ChevronRight className="text-muted-foreground ml-auto size-3.5" aria-hidden />
        </div>
      )}
      <div className={ROW}>
        <Archive className={ICON} aria-hidden />
        Aus der Bürobibliothek
      </div>
      <div className="bg-desk mx-1 my-1.5 h-px" />
      <p className="text-muted-foreground text-meta flex items-center gap-1.5 px-2.5 py-1">
        <Hash className="size-3" aria-hidden />
        Beim Tippen fügt # ein Dokument ein.
      </p>
    </Menu>
  )
}

const PICK_FILES = [
  { name: 'Brandschutzkonzept_Index-D.pdf', meta: 'PDF · 2,4 MB · vor 3 Tagen', picked: true },
  { name: 'Fluchtwegplan_EG-2OG.pdf', meta: 'PDF · 1,1 MB · vor 3 Tagen', picked: true },
  { name: 'Grundriss_EG_Index-C.pdf', meta: 'PDF · 3,8 MB · vor 16 Tagen', picked: false },
  { name: '024-03 ANS_S-Ansicht Süd-West.pdf', meta: 'PDF · 388 kB · vor 16 Tagen', picked: false },
]
const OWN_FILES = [
  { name: 'Leitfaden_Bauherrengespraech.pdf', meta: 'PDF · 420 kB · vor 17 Tagen', picked: true },
  { name: 'Checkliste_Einreichung_Wien.pdf', meta: 'PDF · 180 kB · vor 1 Monat', picked: false },
]

function Source({ icon: Icon, label, sub, picked = false }: { icon: LucideIcon; label: string; sub?: string; picked?: boolean }): JSX.Element {
  return (
    <div className={`flex items-center gap-2.5 rounded-control px-2.5 py-2 ${picked ? 'bg-sheet shadow-xs' : ''}`}>
      <Icon className={ICON} aria-hidden />
      <span className="min-w-0">
        <span className={`text-name block truncate ${picked ? 'font-medium' : 'font-normal'}`}>{label}</span>
        {sub && <span className="text-muted-foreground text-meta block truncate">{sub}</span>}
      </span>
    </div>
  )
}

function Picker({ personal, own, warn }: { personal: boolean; own: boolean; warn: boolean }): JSX.Element {
  const files = own ? OWN_FILES : PICK_FILES
  const count = files.filter((file) => file.picked).length
  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center bg-black/30 pt-16">
      <div className="bg-background shadow-lg flex h-[600px] w-[820px] overflow-hidden rounded-[16px]">
        <div className="bg-desk flex w-[240px] shrink-0 flex-col gap-0.5 p-3">
          <p className="text-pane-title px-2.5 pb-3 pt-1">Dateien anhängen</p>
          {personal ? (
            <>
              <Source icon={LockKeyhole} label="Meine Ablage" sub="Nur Sie" picked={own} />
              <p className="text-muted-foreground text-meta px-2.5 pb-1 pt-3 font-medium">Projekte</p>
              <Source icon={Users} label={PROJECT} picked={!own} />
              <Source icon={Users} label="Sanierung Amtshaus Favoriten" />
              <Source icon={Users} label="Bürohaus Lände 3" />
              <p className="text-muted-foreground text-meta px-2.5 pb-1 pt-3 font-medium">Büro</p>
              <Source icon={Archive} label="Bürobibliothek" />
            </>
          ) : (
            <>
              <Source icon={Users} label="Ablage des Projekts" sub={PROJECT} picked={!own} />
              <Source icon={LockKeyhole} label="Meine Ablage" sub="Nur Sie" picked={own} />
              <Source icon={Archive} label="Bürobibliothek" sub="Für alle im Büro" />
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 px-5 pt-4">
            <div className="border-field-border bg-sheet text-muted-foreground flex h-9 flex-1 items-center gap-2 rounded-control border px-3 text-sm">
              <Search className="size-4" aria-hidden />
              {own ? 'In meiner Ablage suchen …' : 'In der Projektablage suchen …'}
            </div>
            <X className="text-muted-foreground size-4" aria-label="Schließen" />
          </div>
          <p className="text-muted-foreground text-meta border-hairline flex items-center gap-1.5 border-b px-5 py-3">
            {own ? 'Meine Ablage' : 'Ablage des Projekts'}
            <ChevronRight className="size-3" aria-hidden />
            <span className="text-foreground">{own ? 'Vorlagen' : 'Abgabepläne'}</span>
          </p>
          <div className="min-h-0 flex-1 px-3 pt-2">
            {!own && (
              <div className="flex items-center gap-3 rounded-control px-2 py-2">
                <span className="size-4" />
                <Folder className={ICON} aria-hidden />
                <span className="text-name flex-1 font-normal">Fluchtwegnachweise Tiefgarage</span>
                <ChevronRight className="text-muted-foreground size-3.5" aria-hidden />
              </div>
            )}
            {files.map((file) => (
              <div key={file.name} className={`flex items-center gap-3 rounded-control px-2 py-2 ${file.picked ? 'bg-desk' : ''}`}>
                <span className={`flex size-4 items-center justify-center rounded-[4px] ${file.picked ? 'bg-primary text-primary-foreground' : 'border-field-border border'}`}>{file.picked && <Check className="size-3" aria-hidden />}</span>
                <FileText className={ICON} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="text-name block truncate">{file.name}</span>
                  <span className="text-muted-foreground text-meta block">{file.meta}</span>
                </span>
              </div>
            ))}
          </div>
          {warn && (
            <p className="mx-5 mb-3 flex items-start gap-2 rounded-control bg-[#f6ecd6] px-3 py-2 text-[13px] text-[#8a5a00]">
              <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Diese Datei liegt in Ihrer Ablage. In diesem geteilten Chat sehen sie auch Felix Huber und Maria Hofer. In Ihrer Ablage bleibt sie nur für Sie.
            </p>
          )}
          <div className="border-hairline flex items-center justify-between border-t px-5 py-3">
            <span className="text-muted-foreground text-sm">
              {count} ausgewählt{own ? '' : ' · die Dateien bleiben, wo sie liegen'}
            </span>
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm font-medium">Abbrechen</span>
              <span className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-control px-3 text-sm font-medium">Anhängen</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Target({ icon: Icon, label, sub, picked }: { icon: LucideIcon; label: string; sub: string; picked: boolean }): JSX.Element {
  return (
    <div className={`flex flex-1 items-start gap-3 rounded-[10px] p-3 ${picked ? 'bg-sheet shadow-press' : 'bg-desk'}`}>
      <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${picked ? 'border-foreground' : 'border-field-border'}`}>{picked && <span className="bg-foreground size-2 rounded-full" />}</span>
      <span>
        <span className="text-name flex items-center gap-1.5 font-medium">
          <Icon className="size-3.5" aria-hidden />
          {label}
        </span>
        <span className="text-muted-foreground text-meta block">{sub}</span>
      </span>
    </div>
  )
}

function FilingDialog({ made }: { made: boolean }): JSX.Element {
  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center bg-black/30 pt-24">
      <div className="bg-background shadow-lg w-[560px] rounded-[16px] p-5">
        <p className="text-pane-title">Datei ablegen</p>
        <p className="text-muted-foreground mt-1 text-sm">{made ? 'Raumbuch.xlsx' : 'Stellungnahme_MA37.pdf'} liegt bisher nur in diesem Chat.</p>
        <div className="mt-4 flex gap-2">
          <Target icon={Users} label="Ablage des Projekts" sub="Das Projektteam sieht die Datei." picked />
          <Target icon={LockKeyhole} label="Meine Ablage" sub="Nur Sie sehen die Datei." picked={false} />
        </div>
        <p className="text-muted-foreground text-meta mt-4 pb-1.5">Ordner</p>
        <div className="border-field-border bg-sheet flex h-9 items-center gap-2 rounded-control border px-3 text-sm">
          <Folder className={ICON} aria-hidden />
          {made ? 'Berichte' : 'Korrespondenz'}
          <span className="text-muted-foreground text-meta ml-2 inline-flex items-center gap-1">
            <Sparkles className="size-3" aria-hidden />
            Vorschlag von {identity.name}
          </span>
          <span className="text-muted-foreground ml-auto text-sm font-medium">Ändern</span>
        </div>
        <div className="mt-5 flex items-center justify-between">
          <span className="text-muted-foreground text-meta">Der Chat selbst bleibt privat.</span>
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm font-medium">Abbrechen</span>
            <span className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-control px-3 text-sm font-medium">Ablegen</span>
          </span>
        </div>
      </div>
    </div>
  )
}

function Answer(): JSX.Element {
  return (
    <div className="flex max-w-[90%] flex-col gap-2.5">
      <div className="bg-selected h-2 w-[96%] rounded" />
      <div className="bg-selected h-2 w-[88%] rounded" />
      <div className="bg-selected h-2 w-[61%] rounded" />
    </div>
  )
}

const FILE_ACTION = 'text-name border-hairline ml-2 inline-flex h-7 items-center gap-1.5 border-l pl-2.5 font-medium'

export function ChatFiles({ step, personal }: { step: string; personal: boolean }): JSX.Element {
  const shared = step === 'shared'
  const sent = step === 'sent' || step === 'file' || step === 'filed'
  const made = step === 'made' || step === 'madefile'
  const title = shared ? 'Abgleich Statik, Planstand Oktober' : personal ? 'Rampenneigung Tiefgarage' : 'Fluchtweglänge im Erdgeschoss'
  const ready = (
    <>
      <FileChip name="Brandschutzkonzept_Index-D.pdf" origin="project" path="Abgabepläne" close />
      <FileChip name="Leitfaden_Bauherrengespraech.pdf" origin="own" path="Vorlagen" close />
      <FileChip name="Stellungnahme_MA37.pdf" origin="chat" close />
    </>
  )
  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatHeader title={title} shared={shared} />
      <div className="mx-auto mt-6 flex w-full max-w-2xl flex-1 flex-col gap-5 px-8">
        {sent && (
          <>
            <div className="flex max-w-[92%] flex-col items-end gap-2 self-end">
              <div className="bg-desk text-name rounded-[16px] px-3 py-2 font-normal">Passt das Brandschutzkonzept zur Stellungnahme der MA 37?</div>
              <div className="relative flex flex-wrap justify-end gap-2">
                <FileChip name="Brandschutzkonzept_Index-D.pdf" origin="project" path="Abgabepläne" />
                {step === 'filed' ? (
                  <FileChip name="Stellungnahme_MA37.pdf" origin="project" path="Korrespondenz" />
                ) : (
                  <FileChip
                    name="Stellungnahme_MA37.pdf"
                    origin="chat"
                    action={
                      <span className={FILE_ACTION}>
                        <FolderInput className="size-3.5" aria-hidden />
                        Ablegen
                      </span>
                    }
                  />
                )}
                {step === 'sent' && (
                  <Menu at="right-0 top-full mt-1.5 w-72">
                    <div className={`${ROW} bg-desk`}>
                      <Users className={ICON} aria-hidden />
                      In die Ablage des Projekts …
                    </div>
                    <div className={ROW}>
                      <LockKeyhole className={ICON} aria-hidden />
                      In meine Ablage …
                    </div>
                  </Menu>
                )}
              </div>
              {step === 'filed' && (
                <p className="text-muted-foreground text-meta flex items-center gap-2">
                  <Check className="size-3.5" aria-hidden />
                  Abgelegt in „Korrespondenz“. Das Projektteam sieht die Datei.
                  <span className="text-foreground font-medium underline underline-offset-2">Rückgängig</span>
                </p>
              )}
            </div>
            <Answer />
          </>
        )}
        {made && (
          <>
            <div className="bg-desk text-name max-w-[80%] self-end rounded-[16px] px-3 py-2 font-normal">Erstelle ein Raumbuch aus dem Grundriss EG.</div>
            <Answer />
            <div className="bg-sheet shadow-sm flex max-w-[90%] items-center gap-4 rounded-[10px] p-4">
              <span className="bg-desk text-muted-foreground text-meta flex size-14 shrink-0 flex-col items-center justify-center rounded-[8px]">
                <FileText className="size-4" aria-hidden />
                XLSX
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-muted-foreground text-meta flex items-center gap-1">
                  <Paperclip className="size-3" aria-hidden />
                  Nur in diesem Chat · von {identity.name} erstellt
                </span>
                <span className="text-name block font-medium">Raumbuch.xlsx</span>
                <span className="text-muted-foreground text-meta block">XLSX · 10 kB</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="bg-sheet shadow-press inline-flex h-8 items-center rounded-control px-3 text-sm font-medium">Öffnen</span>
                <span className="bg-primary text-primary-foreground inline-flex h-8 items-center gap-1.5 rounded-control px-3 text-sm font-medium">
                  <FolderInput className="size-3.5" aria-hidden />
                  Ablegen
                </span>
              </span>
            </div>
          </>
        )}
        {shared && (
          <>
            <div className="bg-desk text-name max-w-[80%] self-end rounded-[16px] px-3 py-2 font-normal">Stimmt die Statik mit dem Planstand vom Oktober überein?</div>
            <Answer />
          </>
        )}
      </div>
      {step === 'hash' ? (
        <Composer
          typed="Vergleiche das mit #Brand"
          menu={
            <Menu at="bottom-[92px] left-3 w-[420px]">
              <p className="text-muted-foreground text-meta px-2.5 pb-1 pt-1 font-medium">Dokument einfügen</p>
              {[
                { name: 'Brandschutzkonzept_Index-D.pdf', origin: 'project' as const, path: 'Abgabepläne' },
                { name: 'Brandschutz_Checkliste.pdf', origin: 'own' as const, path: 'Vorlagen' },
                { name: 'OIB-Richtlinie 2: Brandschutz', origin: 'office' as const, path: 'Normen & Richtlinien' },
              ].map((hit, index) => {
                const Mark = ORIGIN[hit.origin].icon
                return (
                  <div key={hit.name} className={`flex items-center gap-2.5 rounded-control px-2.5 py-1.5 ${index === 0 ? 'bg-desk' : ''}`}>
                    <FileText className={ICON} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="text-name block truncate">{hit.name}</span>
                      <span className="text-muted-foreground text-meta flex items-center gap-1">
                        <Mark className="size-3" aria-hidden />
                        {ORIGIN[hit.origin].label} › {hit.path}
                      </span>
                    </span>
                  </div>
                )
              })}
            </Menu>
          }
        />
      ) : (
        <Composer
          chips={step === 'ready' ? ready : shared ? <FileChip name="Leitfaden_Bauherrengespraech.pdf" origin="own" path="Vorlagen" close /> : undefined}
          note={
            step === 'ready' ? (
              <p className="text-muted-foreground text-meta flex items-center gap-2">
                {identity.name} antwortet aus diesen 3 Dateien.
                <span className="text-foreground font-medium underline underline-offset-2">Auch im Projekt suchen</span>
              </p>
            ) : shared ? (
              <p className="flex items-start gap-2 rounded-control bg-[#f6ecd6] px-3 py-2 text-[13px] text-[#8a5a00]">
                <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Diese Datei liegt in Ihrer Ablage. Mit dem Senden sehen sie auch Felix Huber und Maria Hofer, aber nur in diesem Chat.
              </p>
            ) : undefined
          }
          menu={step === 'menu' ? <AttachMenu personal={personal} /> : undefined}
        />
      )}
      {(step === 'pick' || step === 'pickown') && <Picker personal={personal} own={step === 'pickown'} warn={false} />}
      {(step === 'file' || step === 'madefile') && <FilingDialog made={step === 'madefile'} />}
    </main>
  )
}
