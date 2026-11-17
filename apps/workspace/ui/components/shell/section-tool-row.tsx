'use client'

import type { JSX } from 'react'
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

const TabActionsContext = createContext<((node: ReactNode, newFolder?: () => void, emptyLevel?: boolean) => void) | null>(null)

export type SectionToolTier = 'wide' | 'medium' | 'narrow'
const TIER_FLOORS: readonly [SectionToolTier, number][] = [
  ['wide', 860],
  ['medium', 680],
]
const tierFor = (width: number): SectionToolTier => TIER_FLOORS.find(([, floor]) => width >= floor)?.[0] ?? 'narrow'
interface LevelTools {
  tools: ReactNode
  newFolder?: () => void
  emptyLevel?: boolean
}
const ToolTierContext = createContext<SectionToolTier | null>(null)
const LevelToolsContext = createContext<LevelTools | null>(null)

const ToolRowContext = createContext(false)

export function useInSectionToolRow(): boolean {
  return useContext(ToolRowContext)
}

export function useSectionToolTier(): SectionToolTier | null {
  return useContext(ToolTierContext)
}

export function SectionLevelTools(): ReactNode {
  return useContext(LevelToolsContext)?.tools ?? null
}

export function useSectionPrimaryYields(): boolean {
  return useContext(LevelToolsContext)?.emptyLevel === true
}

export function useSectionNewFolder(): (() => void) | null {
  const tier = useContext(ToolTierContext)
  const level = useContext(LevelToolsContext)
  if (tier === null || tier === 'wide') return null
  return level?.newFolder ?? null
}

export function useSectionTabActionsSlot(): boolean {
  return useContext(TabActionsContext) !== null
}

export function ProjectSectionTabActions({
  children,
  newFolder,
  emptyLevel = false,
}: {
  children: ReactNode
  newFolder?: () => void
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

const MeasureContext = createContext<{ ref: (element: HTMLDivElement | null) => void; value: SectionToolTier } | null>(null)

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

export function SectionToolRow({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  const measure = useContext(MeasureContext)
  return (
    <div ref={measure?.ref} className={cn('flex min-w-0 items-center', className)} data-testid="files-tool-row" data-tier={measure?.value}>
      <ToolRowContext.Provider value>{children}</ToolRowContext.Provider>
    </div>
  )
}

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
