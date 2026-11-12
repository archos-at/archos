'use client'

/**
 * The folder the reader stands in, handed up to the page's header: the title names the folder, the crumb carries the
 * way there with each step a way up, and the title's line starts with the way one level up. A project's Dateien gets
 * the header from {@link ProjectSectionFrame}; the Büroablage draws the same from {@link SectionPlaceScope}, so going
 * into folders reads the same in both stores (review of 2026-11-11). Before, the Büroablage kept a path row of its own
 * under its tools, with a „Zurück zu …“ press and a second „Alle Dateien“, and a project's Dateien a crumb.
 */

import type { JSX } from 'react'
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

/**
 * Where the reader stands inside a place, when it is deeper than the place itself: Alle Dateien's open folder. The
 * title names it („Index C“, not „Alle Dateien“ over a folder's contents), the crumb carries the way there after the
 * project („Projekt › Dateien › Abgabepläne › …“, `trail`, each step a way up), and on a phone, which has no crumb,
 * the title's line starts with the way one level up (`up`). The tab still names the place.
 */
export interface SectionPlace {
  title: string
  /** The crumb after the project's name: the section's own step and the levels between it and `title`. */
  trail: ReactNode
  /** A phone's one-line crumb above the title, without the project: „… › Fluchtwegnachweise Tiefgarage“. */
  phoneTrail?: ReactNode
  /** One level up, for the phone's ← („Zurück zu Abgabepläne“). */
  up: { label: string; onSelect: () => void }
  /** What the level holds, beside the title in muted 13px („240 Elemente“): a folder of hundreds said nothing. */
  count?: string
}
export const PlaceContext = createContext<((place: SectionPlace | null) => void) | null>(null)

/** Whether a header draws {@link ProjectSectionPlace} (a project's frame, the Büroablage); outside one (a preview) the page keeps its own path row. */
export function useSectionPlaceSlot(): boolean {
  return useContext(PlaceContext) !== null
}

/** Hand the frame's title and crumb the level the reader stands in. Renders nothing at the call site. */
export function ProjectSectionPlace({ title, trail, phoneTrail, up, count }: SectionPlace): null {
  const setPlace = useContext(PlaceContext)
  useLayoutEffect(() => {
    if (!setPlace) return
    setPlace({ title, trail, phoneTrail, up, count })
    return () => setPlace(null)
  }, [title, trail, phoneTrail, up, count, setPlace])
  return null
}

/**
 * The name of the store a trail starts from („Dateien“ in a project, „Büroablage“ for the office): the first step of
 * the crumb, and where its ← goes from a top-level folder. Null reads the project's „Dateien“.
 */
export const PlaceRootContext = createContext<string | null>(null)

const PlaceValueContext = createContext<SectionPlace | null>(null)

/**
 * The place's state outside a project's frame (the Büroablage). The state lives here and not in the page, so a change
 * re-renders only the header that reads it ({@link useSectionPlace}): held by the page, it re-rendered the listing,
 * whose folder handed the place up again, a render loop.
 */
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

/** The open folder inside a {@link SectionPlaceScope}, or null at the store's top. */
export function useSectionPlace(): SectionPlace | null {
  return useContext(PlaceValueContext)
}

/** The store's name for the trail's first step, or null for a project's Dateien. */
export function useSectionPlaceRoot(): string | null {
  return useContext(PlaceRootContext)
}

/** The way one level up, at the start of the title's line: a 44px target whose arrow sits on the title's edge. */
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
