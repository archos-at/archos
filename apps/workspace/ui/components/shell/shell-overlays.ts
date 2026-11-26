import { create } from 'zustand'

export type PaletteSummon = 'keyboard' | 'pointer'

interface ShellOverlaysState {
  paletteOpen: boolean
  paletteSummon: PaletteSummon
  menuOpen: boolean
  setPaletteOpen: (open: boolean) => void
  openPaletteByPointer: () => void
  togglePalette: () => void
  setMenuOpen: (open: boolean) => void
}

export const useShellOverlays = create<ShellOverlaysState>()((set) => ({
  paletteOpen: false,
  paletteSummon: 'keyboard',
  menuOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  openPaletteByPointer: () => set({ paletteOpen: true, paletteSummon: 'pointer' }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen, paletteSummon: 'keyboard' })),
  setMenuOpen: (open) => set({ menuOpen: open }),
}))
