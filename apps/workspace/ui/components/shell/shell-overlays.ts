import { create } from 'zustand'

export type PaletteSummon = 'keyboard' | 'pointer'

export type MoreSheetView = 'more' | 'projects'

interface ShellOverlaysState {
  paletteOpen: boolean
  paletteSummon: PaletteSummon
  moreSheetOpen: boolean
  moreSheetView: MoreSheetView
  setPaletteOpen: (open: boolean) => void
  openPaletteByPointer: () => void
  togglePalette: () => void
  setMoreSheetOpen: (open: boolean, view?: MoreSheetView) => void
}

export const useShellOverlays = create<ShellOverlaysState>()((set) => ({
  paletteOpen: false,
  paletteSummon: 'keyboard',
  moreSheetOpen: false,
  moreSheetView: 'more',
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  openPaletteByPointer: () => set({ paletteOpen: true, paletteSummon: 'pointer' }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen, paletteSummon: 'keyboard' })),
  setMoreSheetOpen: (open, view = 'more') => set({ moreSheetOpen: open, moreSheetView: view }),
}))
