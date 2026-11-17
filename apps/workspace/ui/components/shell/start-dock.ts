import { create } from 'zustand'

import { DOCK_LAYOUT_QUERY } from '@/hooks/use-is-mobile'
import { useMediaQuery } from '@/hooks/use-media-query'

export type StartDockPanel = 'inbox'

export const START_DOCK_WIDTH_MIN = 280
export const START_DOCK_WIDTH_MAX = 520
export const START_DOCK_WIDTH_DEFAULT = 360

const OPEN_KEY = 'startDock.panel'
const WIDTH_KEY = 'startDock.width'

const clampWidth = (width: number): number => Math.min(START_DOCK_WIDTH_MAX, Math.max(START_DOCK_WIDTH_MIN, Math.round(width)))

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}

function write(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key)
    else storage().setItem(key, value)
  } catch {
    // Not remembered; nothing else changes.
  }
}

const session = (): Storage => window.sessionStorage
const local = (): Storage => window.localStorage

interface StartDockState {
  panel: StartDockPanel | null
  width: number
  takesFocus: boolean
  focusTaken: () => void
  open: (panel: StartDockPanel) => void
  close: () => void
  toggle: (panel: StartDockPanel) => void
  setWidth: (width: number) => void
  restoreWidth: () => number | null
  restore: () => void
}

export const useStartDock = create<StartDockState>()((set, get) => ({
  panel: null,
  width: START_DOCK_WIDTH_DEFAULT,
  takesFocus: false,
  focusTaken: () => set({ takesFocus: false }),
  open: (panel) => {
    set({ panel, takesFocus: true })
    write(session, OPEN_KEY, panel)
  },
  close: () => {
    set({ panel: null, takesFocus: false })
    write(session, OPEN_KEY, null)
  },
  toggle: (panel) => (get().panel === panel ? get().close() : get().open(panel)),
  setWidth: (width) => {
    const next = clampWidth(width)
    set({ width: next })
    write(local, WIDTH_KEY, String(next))
  },
  restoreWidth: () => {
    const stored = Number(read(local, WIDTH_KEY))
    if (!Number.isFinite(stored) || stored <= 0) return null
    const width = clampWidth(stored)
    set({ width })
    return width
  },
  restore: () => {
    const stored = read(session, OPEN_KEY)
    if (stored === 'inbox') set({ panel: stored })
  },
}))

export const defaultStartDockWidth = (): number => START_DOCK_WIDTH_DEFAULT

export interface StartDockDoor {
  panel: StartDockPanel
  open: boolean
  onClick: (event: { defaultPrevented: boolean; button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault: () => void }) => void
}

export function useStartDockDoor(panel: StartDockPanel): StartDockDoor {
  const fits = useMediaQuery(DOCK_LAYOUT_QUERY)
  const open = useStartDock((state) => state.panel === panel) && fits
  const toggle = useStartDock((state) => state.toggle)
  return {
    panel,
    open,
    onClick: (event) => {
      const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
      if (!fits || !plain || event.defaultPrevented) return
      event.preventDefault()
      toggle(panel)
    },
  }
}

export function useStartDockShown(): boolean {
  const fits = useMediaQuery(DOCK_LAYOUT_QUERY)
  return useStartDock((state) => state.panel !== null) && fits
}

export const PAGE_INSET_START_VAR = '--page-inset-start'
export const PAGE_INSET_TOP_VAR = '--page-inset-top'

export function focusStartDockDoor(panel: StartDockPanel): void {
  const doors = document.querySelectorAll<HTMLElement>(`[data-dock-door="${panel}"]`)
  const shown = [...doors].find((door) => door.getClientRects().length > 0)
  shown?.focus({ preventScroll: true })
}
