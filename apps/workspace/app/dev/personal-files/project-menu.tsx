'use client'

// PROTOTYPE, not for merge: the project menu and the project overview for the personal-area concept (ticket 81).

import type { JSX } from 'react'
import { Check, ChevronRight, Layers, LayoutGrid, Plus, Search, Settings, X } from 'lucide-react'

import { PROJECTS } from '../personal-area-rail/prototype'

function ProjectRow({ name, current = false }: { name: string; current?: boolean }): JSX.Element {
  return (
    <div className={`text-name flex h-9 items-center gap-2.5 rounded-control px-2.5 font-normal ${current ? 'bg-desk' : ''}`}>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {current && <Check className="size-4 shrink-0" aria-hidden />}
    </div>
  )
}

export function ProjectMenu({ form }: { form: string }): JSX.Element {
  const settings = (
    <div className="text-name flex h-9 items-center gap-2.5 rounded-control px-2.5 font-normal">
      <Settings className="text-muted-foreground size-4 shrink-0" aria-hidden />
      Projekteinstellungen
    </div>
  )
  const rule = <div className="bg-desk mx-1 my-1.5 h-px" />
  const label = (text: string): JSX.Element => <div className="text-muted-foreground text-meta px-2.5 pb-1 pt-1 font-medium">{text}</div>
  const projects = PROJECTS.map((item) => <ProjectRow key={item.id} name={item.name} current={item.id === 'p-1'} />)
  return (
    <div className="bg-sheet shadow-md absolute left-0 right-0 top-full z-50 mt-1.5 rounded-[16px] p-1.5">
      {form === 'top' && (
        <>
          <div className="text-name flex h-9 items-center gap-2.5 rounded-control px-2.5 font-medium">
            <Layers className="size-4 shrink-0" aria-hidden />
            Alle Projekte
          </div>
          {rule}
          {label('Projekte')}
          {projects}
          {rule}
          {settings}
        </>
      )}
      {form === 'final' && (
        <>
          <div className="text-name flex h-9 items-center gap-2.5 rounded-control px-2.5 font-medium">
            <Layers className="size-4 shrink-0" aria-hidden />
            Projektübergreifend
          </div>
          {rule}
          {label('Projekte')}
          {projects}
          <div className="text-name bg-selected flex h-9 items-center gap-2.5 rounded-control px-2.5 font-normal">
            <LayoutGrid className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Projektübersicht
          </div>
          {rule}
          {settings}
        </>
      )}
      {(form === 'blocks' || form === 'gear' || form === 'inline') && (
        <>
          <div className="bg-desk mb-1.5 flex items-center gap-3 rounded-[10px] p-2.5">
            <span className="bg-sheet shadow-xs flex size-8 shrink-0 items-center justify-center rounded-control">
              <Layers className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="text-name block font-medium">Projektübergreifend</span>
              <span className="text-muted-foreground text-meta block">Fragen ohne Bindung an ein Projekt</span>
            </span>
          </div>
          {form === 'blocks' && (
            <>
              {label('Aktuelles Projekt')}
              <ProjectRow name={PROJECTS[0]!.name} current />
              <div className="text-name text-muted-foreground flex h-8 items-center gap-2.5 rounded-control pl-6 pr-2.5 font-normal">
                <Settings className="size-3.5 shrink-0" aria-hidden />
                Einstellungen dieses Projekts
              </div>
              {label('Wechseln zu')}
              {PROJECTS.slice(1).map((item) => (
                <ProjectRow key={item.id} name={item.name} />
              ))}
            </>
          )}
          {form === 'gear' && (
            <>
              {label('Projekte')}
              <div className="text-name bg-desk flex h-9 items-center gap-1.5 rounded-control pl-2.5 pr-1 font-normal">
                <span className="min-w-0 flex-1 truncate">{PROJECTS[0]!.name}</span>
                <Check className="size-4 shrink-0" aria-hidden />
                <span title="Einstellungen dieses Projekts" className="bg-sheet shadow-press text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-control">
                  <Settings className="size-3.5" aria-hidden />
                </span>
              </div>
              {PROJECTS.slice(1).map((item) => (
                <ProjectRow key={item.id} name={item.name} />
              ))}
            </>
          )}
          {form === 'inline' && (
            <>
              {label('Projekte')}
              <div className="bg-desk rounded-control px-2.5 py-2">
                <div className="text-name flex items-center gap-2 font-normal">
                  <span className="min-w-0 flex-1 truncate">{PROJECTS[0]!.name}</span>
                  <Check className="size-4 shrink-0" aria-hidden />
                </div>
                <span className="text-meta mt-1 inline-flex items-center gap-1.5 font-medium underline underline-offset-2">
                  <Settings className="size-3.5" aria-hidden />
                  Einstellungen
                </span>
              </div>
              {PROJECTS.slice(1).map((item) => (
                <ProjectRow key={item.id} name={item.name} />
              ))}
            </>
          )}
          {rule}
          <div className="grid grid-cols-2 gap-1.5 p-1">
            <span className="shadow-press text-name inline-flex h-8 items-center justify-center gap-1.5 rounded-control font-medium">
              <LayoutGrid className="size-3.5" aria-hidden />
              Übersicht
            </span>
            <span className="shadow-press text-name inline-flex h-8 items-center justify-center gap-1.5 rounded-control font-medium">
              <Plus className="size-3.5" aria-hidden />
              Neues Projekt
            </span>
          </div>
        </>
      )}
      {form === 'card' && (
        <>
          <div className="bg-desk mb-1.5 flex items-center gap-3 rounded-[10px] p-2.5">
            <span className="bg-sheet shadow-xs flex size-8 shrink-0 items-center justify-center rounded-control">
              <Layers className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="text-name block font-medium">Alle Projekte</span>
              <span className="text-muted-foreground text-meta block">Ohne Bindung an ein Projekt</span>
            </span>
          </div>
          {label('Projekte')}
          {projects}
          {rule}
          {settings}
        </>
      )}
      {form === 'foot' && (
        <>
          {settings}
          {rule}
          {label('Projekt wechseln')}
          {projects}
          {rule}
          <div className="text-name flex h-9 items-center gap-2.5 rounded-control px-2.5 font-medium">
            <Layers className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">Alle Projekte</span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
          </div>
        </>
      )}
      {form === 'mark' && (
        <>
          {settings}
          {rule}
          {label('Projekt wechseln')}
          <div className="text-name flex h-9 items-center gap-2.5 rounded-control px-2.5 font-medium">
            <span className="min-w-0 flex-1 truncate">Alle Projekte</span>
            <span className="bg-desk text-muted-foreground text-meta rounded-full px-2 py-0.5 font-medium">projektübergreifend</span>
          </div>
          {projects}
        </>
      )}
    </div>
  )
}

const OVERVIEW = [
  { name: 'Wohnbau Seestadt Baufeld D12', meta: 'Wien · Einreichplanung', current: true },
  { name: 'Sanierung Amtshaus Favoriten', meta: 'Wien · Ausführungsplanung' },
  { name: 'Bürohaus Lände 3', meta: 'Wien · Entwurf' },
  { name: 'Kindergarten Stammersdorf', meta: 'Wien · Einreichplanung' },
  { name: 'Volksschule Mühlgasse', meta: 'Pausiert' },
  { name: 'Dachausbau Kaiserstraße 12', meta: 'Abgeschlossen' },
]

export function ProjectOverview(): JSX.Element {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[rgb(15_14_13_/_0.4)] p-8">
      <div className="bg-background shadow-lg flex w-full max-w-[820px] flex-col gap-5 rounded-[16px] p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-page-title">Projektübersicht</h2>
          <div className="flex items-center gap-2">
            <span className="bg-primary text-primary-foreground inline-flex h-8 items-center gap-1.5 rounded-control px-3 text-xs font-medium">
              <Plus className="size-3.5" aria-hidden />
              Neues Projekt
            </span>
            <span className="text-muted-foreground flex size-8 items-center justify-center rounded-control">
              <X className="size-4" aria-label="Schließen" />
            </span>
          </div>
        </div>
        <div className="border-field-border bg-sheet text-muted-foreground flex h-9 items-center gap-2 rounded-control border px-3 text-sm">
          <Search className="size-4" aria-hidden />
          Projekt suchen …
        </div>
        <div className="grid grid-cols-3 gap-3">
          {OVERVIEW.map((item) => (
            <div key={item.name} className={`bg-sheet flex h-[92px] flex-col justify-between rounded-[10px] p-3 ${item.current ? 'ring-foreground shadow-sm ring-[1.5px]' : 'shadow-sm'}`}>
              <span className="text-name font-medium">{item.name}</span>
              <span className="text-muted-foreground text-meta">{item.meta}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
