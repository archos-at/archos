import { create } from 'zustand'

import type { RailMode } from './rail-mode'

export interface RailSide {
  mode: RailMode
  projectId: string | null
}

const SETTLE_AFTER_MS = 4000

interface RailSideState {
  pending: RailSide | null
  begin: (side: RailSide) => void
  settle: () => void
}

let settleTimer: ReturnType<typeof setTimeout> | undefined

export const useRailSide = create<RailSideState>()((set) => ({
  pending: null,
  begin: (pending) => {
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => set({ pending: null }), SETTLE_AFTER_MS)
    set({ pending })
  },
  settle: () => {
    clearTimeout(settleTimer)
    set({ pending: null })
  },
}))

export function shownSide(pending: RailSide | null, route: RailSide | null): RailSide | null {
  if (!pending || !route) return route
  return pending.mode === 'personal' || pending.projectId !== null ? pending : route
}
