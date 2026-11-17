import { create } from 'zustand'

interface ShellOverlaysState {
  paletteOpen: boolean
  moreSheetOpen: boolean
  setPaletteOpen: (open: boolean) => void
  togglePalette: () => void
  setMoreSheetOpen: (open: boolean) => void
}

export const useShellOverlays = create<ShellOverlaysState>()((set) => ({
  paletteOpen: false,
  moreSheetOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
  setMoreSheetOpen: (open) => set({ moreSheetOpen: open }),
}))
