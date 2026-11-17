'use client'

import { useCallback, useEffect, useState } from 'react'

export type FileView = 'cards' | 'list'

const VIEW_STORAGE_KEY = 'files.view'

export const LIST_VIEW_ABOVE = 50

export function fileViewFor(chosen: FileView | null, count: number): FileView {
  return chosen ?? (count > LIST_VIEW_ABOVE ? 'list' : 'cards')
}

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
