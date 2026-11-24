import { create } from 'zustand'

export type PaletteSummon = 'keyboard' | 'pointer'

interface ShellOverlaysState {
  paletteOpen: boolean
  paletteSummon: PaletteSummon
  moreSheetOpen: boolean
  setPaletteOpen: (open: boolean) => void
  openPaletteByPointer: () => void
  togglePalette: () => void
  setMoreSheetOpen: (open: boolean) => void
}

export const useShellOverlays = create<ShellOverlaysState>()((set) => ({
  paletteOpen: false,
  paletteSummon: 'keyboard',
  moreSheetOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  openPaletteByPointer: () => set({ paletteOpen: true, paletteSummon: 'pointer' }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen, paletteSummon: 'keyboard' })),
  setMoreSheetOpen: (open) => set({ moreSheetOpen: open }),
}))
