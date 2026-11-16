'use client'

import type { JSX } from 'react'
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

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
