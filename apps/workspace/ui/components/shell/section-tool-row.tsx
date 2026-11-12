'use client'

/**
 * Dateien's tool row: one row under the title that never wraps, what finds on the left and what acts on the level on
 * the right, measured into a tier as it narrows. A project's Dateien gets it from {@link ProjectSectionFrame}; the
 * Büroablage, which is a project's Dateien with the project taken out, wraps its workspace in the same scope
 * ({@link SectionToolRowScope}) and draws the same row ({@link SectionToolRow}). Before, the Büroablage was „outside
 * the frame“: its tools stood beside its title in the old wrapping cluster and broke into three ragged rows at 1440px
 * (review of 2026-11-11, „der Header ist ganz chaotisch“).
 */

import type { JSX } from 'react'
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The end of the tabs row, for the tools of the level a tab shows (Dateien's
 * „Auswählen“ and „Ordner anlegen“ at the root): null where there is no such
 * row (a phone, a page outside the frame), and the caller keeps them inline.
 */
const TabActionsContext = createContext<((node: ReactNode, newFolder?: () => void, emptyLevel?: boolean) => void) | null>(null)

/**
 * How much of Dateien's tool row fits beside itself, from the row's own width: `wide` holds every press with its
 * words; `medium` moves „Ordner anlegen“ into Hochladen's menu (from about 1100px of screen beside the rail);
 * `narrow` (a tablet beside the rail) folds the view into the ⋯, the filter to its glyph and Hochladen to its glyph.
 * The row never wraps: it wrapped into three rows at 1440px beside a long title (review of 2026-11-10, finding 1).
 */
export type SectionToolTier = 'wide' | 'medium' | 'narrow'
/** The row widths (px) at which a tier begins; the German words are the wider ones. */
const TIER_FLOORS: readonly [SectionToolTier, number][] = [
  ['wide', 860],
  ['medium', 680],
]
const tierFor = (width: number): SectionToolTier => TIER_FLOORS.find(([, floor]) => width >= floor)?.[0] ?? 'narrow'
interface LevelTools {
  tools: ReactNode
  newFolder?: () => void
  /** The level shows its empty state, whose Hochladen is the pane's one primary: the row's steps back. */
  emptyLevel?: boolean
}
// Two contexts: the level's tools are registered by a reader of the tier (`FolderBreadcrumbRow`), and one context
// holding both re-rendered it on every registration, which registered again (a render loop).
const ToolTierContext = createContext<SectionToolTier | null>(null)
const LevelToolsContext = createContext<LevelTools | null>(null)

/** True inside the tool row: its Hochladen is the one that steps back, folds to its glyph and takes „Neuer Ordner“. */
const ToolRowContext = createContext(false)

/** Whether this control stands in Dateien's tool row (the empty state's Hochladen does not, and keeps its ink). */
export function useInSectionToolRow(): boolean {
  return useContext(ToolRowContext)
}

/** The tool row's tier, or null outside the section's frame (the Büroablage, a spec), which keeps its own header. */
export function useSectionToolTier(): SectionToolTier | null {
  return useContext(ToolTierContext)
}

/** Where the level's own tools („Auswählen“, „Ordner anlegen“) stand in the tool row: before Hochladen. */
export function SectionLevelTools(): ReactNode {
  return useContext(LevelToolsContext)?.tools ?? null
}

/**
 * Whether the tool row's Hochladen steps back to the raised press: an empty level's own Hochladen is the one ink press
 * then (one primary per pane; two black Hochladen 300px apart asked which one, review of 2026-11-10, finding 8).
 */
export function useSectionPrimaryYields(): boolean {
  return useContext(LevelToolsContext)?.emptyLevel === true
}

/** „Neuer Ordner“ for Hochladen's menu, where the row has no room for its press; null where the press stands. */
export function useSectionNewFolder(): (() => void) | null {
  const tier = useContext(ToolTierContext)
  const level = useContext(LevelToolsContext)
  if (tier === null || tier === 'wide') return null
  return level?.newFolder ?? null
}

/** Whether {@link ProjectSectionTabActions} has a row to go to; where not, the caller renders its tools itself. */
export function useSectionTabActionsSlot(): boolean {
  return useContext(TabActionsContext) !== null
}

/**
 * Portal a tab's level tools to the end of its tabs row. At the root of
 * Dateien the path row held only these two presses, a row of its own above
 * the brief; beside the tab that names the level they cost no row. Renders
 * nothing at the call site.
 */
export function ProjectSectionTabActions({
  children,
  newFolder,
  emptyLevel = false,
}: {
  children: ReactNode
  /** Opens „Neuer Ordner“ from Hochladen's menu, where the row has no room for the press (`useSectionNewFolder`). */
  newFolder?: () => void
  /** The level shows its empty state (`useSectionPrimaryYields`). */
  emptyLevel?: boolean
}): null {
  const setTabActions = useContext(TabActionsContext)
  useLayoutEffect(() => {
    if (!setTabActions) return
    setTabActions(children, newFolder, emptyLevel)
    return () => setTabActions(null)
  }, [children, newFolder, emptyLevel, setTabActions])
  return null
}

/** The row's width, measured: its ref and the tier it reads, for {@link SectionToolRow}. */
const MeasureContext = createContext<{ ref: (element: HTMLDivElement | null) => void; value: SectionToolTier } | null>(null)

/**
 * The scope a tool row lives in: the level's tools register into it from the listing (`FolderBreadcrumbRow`), and
 * the row's controls read its tier. It wraps the header AND the listing, since the listing is where the level's tools
 * come from. `enabled` false (a phone) keeps every reader at „no row“, and the tools stay inline.
 */
export function SectionToolRowScope({ enabled, children }: { enabled: boolean; children: ReactNode }): JSX.Element {
  const [level, setLevel] = useState<LevelTools | null>(null)
  const setTabActions = useCallback(
    (tools: ReactNode, newFolder?: () => void, emptyLevel?: boolean) => setLevel(tools === null ? null : { tools, newFolder, emptyLevel }),
    []
  )
  const tier = useToolTier()
  return (
    <MeasureContext.Provider value={tier}>
      <TabActionsContext.Provider value={enabled ? setTabActions : null}>
        <ToolTierContext.Provider value={enabled ? tier.value : null}>
          <LevelToolsContext.Provider value={enabled ? level : null}>{children}</LevelToolsContext.Provider>
        </ToolTierContext.Provider>
      </TabActionsContext.Provider>
    </MeasureContext.Provider>
  )
}

/** The row itself, on the title's left edge, inside a {@link SectionToolRowScope}: it measures the tier. */
export function SectionToolRow({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  const measure = useContext(MeasureContext)
  return (
    <div ref={measure?.ref} className={cn('flex min-w-0 items-center', className)} data-testid="files-tool-row" data-tier={measure?.value}>
      <ToolRowContext.Provider value>{children}</ToolRowContext.Provider>
    </div>
  )
}

/** The tool row's tier from its width, measured before paint and on every resize. */
function useToolTier(): { ref: (element: HTMLDivElement | null) => void; value: SectionToolTier } {
  const [value, setValue] = useState<SectionToolTier>('wide')
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!element) return
    const read = (): void => setValue(tierFor(element.getBoundingClientRect().width))
    read()
    if (typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(read)
    observer.current.observe(element)
  }, [])
  return { ref, value }
}
