'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Presentation of the file browser.
 *
 * `cards` browses, `list` is the explorer detail view for a corpus too large to
 * skim as tiles. Both read the same documents through the same search and the
 * same folder drill-down.
 */
export type FileView = 'cards' | 'list'

const VIEW_STORAGE_KEY = 'files.view'

/**
 * Above this many documents on a level the list is the default (paper on a
 * desk, principle 8: dense by default). Tiles are for browsing by sight; past
 * fifty a reader scans names, and a 40px row shows four times as many as a tile.
 */
export const LIST_VIEW_ABOVE = 50

/** The view a level opens in: the reader's own choice, or by how many documents it holds. */
export function fileViewFor(chosen: FileView | null, count: number): FileView {
  return chosen ?? (count > LIST_VIEW_ABOVE ? 'list' : 'cards')
}

/**
 * Cards or list as the reader chose it, remembered per browser — and shared by
 * every shelf, so the choice made in Dateien is the one the Archiv opens in.
 * Null until they choose: the level decides then ({@link fileViewFor}). A
 * stored value that is neither (the removed third view) counts as no choice.
 */
export function useViewPreference(): readonly [FileView | null, (next: FileView) => void] {
  const [view, setView] = useState<FileView | null>(null)
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_STORAGE_KEY)
      if (stored === 'cards' || stored === 'list') setView(stored)
    } catch {
      // Storage unavailable — the choice holds for this visit.
    }
  }, [])
  const select = useCallback((next: FileView) => {
    setView(next)
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // As above.
    }
  }, [])
  return [view, select] as const
}
