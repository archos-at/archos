'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useUndoableArchive } from '@/features/collaboration/hooks/use-undoable-archive'
import {
  SavedSearchError,
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  updateSavedSearch,
  type SavedSearchDraft,
  type SavedSearchView,
} from '@/lib/search/saved-search-client'
import { captureSavedSearchCreated } from '../lib/search-telemetry'

export const SAVED_SEARCH_UNDO_MS = 6000

export interface SavedSearches {
  items: SavedSearchView[] | null
  failed: boolean
  save: (draft: SavedSearchDraft) => Promise<SavedSearchView | null>
  toggleShare: (item: SavedSearchView) => Promise<boolean>
  rename: (item: SavedSearchView, name: string) => Promise<SavedSearchRenameOutcome>
  remove: (item: SavedSearchView) => void
  undoRemove: (item: SavedSearchView) => void
}

export type SavedSearchRenameOutcome = 'renamed' | 'taken' | 'failed'

export interface SavedSearchesOptions {
  onRemoveFailed?: () => void
  undoMs?: number
}

export function useSavedSearches({ onRemoveFailed, undoMs = SAVED_SEARCH_UNDO_MS }: SavedSearchesOptions = {}): SavedSearches {
  const [items, setItems] = useState<SavedSearchView[] | null>(null)
  const [failed, setFailed] = useState(false)
  const failedRef = useRef(onRemoveFailed)
  useEffect(() => {
    failedRef.current = onRemoveFailed
  }, [onRemoveFailed])

  useEffect(() => {
    let cancelled = false
    listSavedSearches()
      .then((list) => {
        if (!cancelled) setItems(list)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const commitDelete = useCallback(async (id: string): Promise<void> => {
    try {
      await deleteSavedSearch(id)
      setItems((list) => (list ?? []).filter((entry) => entry.id !== id))
    } catch {
      failedRef.current?.()
    }
  }, [])
  const deleting = useUndoableArchive(commitDelete, undoMs)

  const save = useCallback(async (draft: SavedSearchDraft) => {
    try {
      const created = await createSavedSearch(draft)
      captureSavedSearchCreated(created)
      setItems((list) => [created, ...(list ?? [])])
      setFailed(false)
      return created
    } catch {
      return null
    }
  }, [])

  const toggleShare = useCallback(async (item: SavedSearchView) => {
    const shared = !item.shared
    setItems((list) => (list ?? []).map((entry) => (entry.id === item.id ? { ...entry, shared } : entry)))
    try {
      await updateSavedSearch(item.id, { shared })
      return true
    } catch {
      setItems((list) => (list ?? []).map((entry) => (entry.id === item.id ? { ...entry, shared: item.shared } : entry)))
      return false
    }
  }, [])

  const rename = useCallback(async (item: SavedSearchView, name: string): Promise<SavedSearchRenameOutcome> => {
    try {
      await updateSavedSearch(item.id, { name })
      setItems((list) => (list ?? []).map((entry) => (entry.id === item.id ? { ...entry, name } : entry)))
      return 'renamed'
    } catch (error) {
      return error instanceof SavedSearchError && error.status === 409 ? 'taken' : 'failed'
    }
  }, [])

  const { request, undo, pendingIds } = deleting
  const remove = useCallback((item: SavedSearchView) => request(item.id), [request])
  const undoRemove = useCallback((item: SavedSearchView) => undo(item.id), [undo])
  const visible = useMemo(() => (items === null ? null : items.filter((entry) => !pendingIds.has(entry.id))), [items, pendingIds])

  return { items: visible, failed, save, toggleShare, rename, remove, undoRemove }
}
