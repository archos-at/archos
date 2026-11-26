'use client'

import type { JSX } from 'react'
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'

export interface SectionPlace {
  title: string
  trail: ReactNode
  phoneTrail?: ReactNode
  up: { label: string; onSelect: () => void }
  count?: string
}
export const PlaceContext = createContext<((place: SectionPlace | null) => void) | null>(null)

export function useSectionPlaceSlot(): boolean {
  return useContext(PlaceContext) !== null
}

export function ProjectSectionPlace({ title, trail, phoneTrail, up, count }: SectionPlace): null {
  const setPlace = useContext(PlaceContext)
  useLayoutEffect(() => {
    if (!setPlace) return
    setPlace({ title, trail, phoneTrail, up, count })
    return () => setPlace(null)
  }, [title, trail, phoneTrail, up, count, setPlace])
  return null
}

export const PlaceRootContext = createContext<string | null>(null)

const PlaceValueContext = createContext<SectionPlace | null>(null)

export function SectionPlaceScope({ root, children }: { root: string; children: ReactNode }): JSX.Element {
  const [place, setPlace] = useState<SectionPlace | null>(null)
  return (
    <PlaceRootContext.Provider value={root}>
      <PlaceContext.Provider value={setPlace}>
        <PlaceValueContext.Provider value={place}>{children}</PlaceValueContext.Provider>
      </PlaceContext.Provider>
    </PlaceRootContext.Provider>
  )
}

export function useSectionPlace(): SectionPlace | null {
  return useContext(PlaceValueContext)
}

export function useSectionPlaceRoot(): string | null {
  return useContext(PlaceRootContext)
}

export function SectionPlaceUp({ up }: { up: SectionPlace['up'] }): JSX.Element {
  return (
    <button
      type="button"
      onClick={up.onSelect}
      aria-label={up.label}
      title={up.label}
      data-testid="page-header-up"
      className="text-foreground hover:bg-desk active:bg-desk -ml-3 -mr-2 flex size-11 items-center justify-center rounded-control"
    >
      <ArrowLeft className="size-4" aria-hidden />
    </button>
  )
}

export function SectionPlaceLine({ place }: { place: SectionPlace }): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <div className="border-border flex h-11 min-w-0 items-center gap-2 border-b" data-testid="section-place-line">
      <button
        type="button"
        onClick={place.up.onSelect}
        aria-label={place.up.label}
        title={place.up.label}
        data-testid="page-header-up"
        className="text-muted-foreground hover:bg-desk hover:text-foreground -ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-control pointer-coarse:size-11"
      >
        <ArrowLeft className="size-4" aria-hidden />
      </button>
      <nav aria-label={t('folders.breadcrumb')} className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[13px] leading-5">
        {place.trail}
        <ChevronRight className="size-3 shrink-0" aria-hidden />
        <span className="text-foreground min-w-0 truncate font-medium" title={place.title} data-testid="section-place-current">
          {place.title}
        </span>
        {place.count && <span className="shrink-0 tabular-nums" data-testid="page-header-count">{place.count}</span>}
      </nav>
    </div>
  )
}
