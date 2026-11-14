'use client'

import { useMemo } from 'react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { FileItem } from '../file-types'
import { NO_FILE_FILTERS, activeFilterCount, type FileFilters } from '../lib/file-filters'
import type { useFileSearch } from './use-file-search'

/**
 * When a FILTER emptied the level rather than the folder being empty.
 *
 * The browser pane is handed already-filtered files and cannot tell the two
 * apart, so it drew "this folder is empty" over a folder full of documents the
 * moment a filter matched nothing. Authorship wins when several are on: it is
 * the narrower and the less obvious, so it is the one a reader needs explained.
 */
export function useFilterEmptyNotice({
  filters,
  setFilters,
  canCollaborate,
  search,
  levelFiles,
  levelOccupied,
}: {
  filters: FileFilters
  setFilters: (next: FileFilters) => void
  canCollaborate: boolean
  search: ReturnType<typeof useFileSearch>
  levelFiles: readonly FileItem[]
  /**
   * Whether the level holds documents before the browser's filters: the
   * shelf summary's count on a paged level (ADR-0102), the drained rows else.
   */
  levelOccupied: boolean
}) {
  const t = useTranslations(filesCopy)
  const { query } = search
  const semanticActive = search.semantic.active
  return useMemo(() => {
    const clear = () => setFilters(NO_FILE_FILTERS)
    if (activeFilterCount(filters, canCollaborate) === 0) return null
    // The notice REPLACES the whole listing, so it may only exist when the
    // listing is actually empty; a query or semantic search owns its own states.
    if (query.trim() !== '' || semanticActive) return null
    if (levelFiles.length > 0) return null
    // An unfiltered-empty level is an empty folder, not a filter hiding anything.
    if (!levelOccupied) return null
    if (filters.agentAuthoredOnly) {
      return { title: t('authorship.emptyTitle'), description: t('authorship.emptyDescription'), onClear: clear }
    }
    if (canCollaborate && filters.assignment !== 'all') {
      const title = filters.assignment === 'mine' ? t('assignment.emptyMine') : t('assignment.emptyUnassigned')
      return { title, description: t('assignment.emptyDescription'), onClear: clear }
    }
    // Type, status and tag say what they mean on the chip; what the reader needs
    // is the fact that a filter, and not an empty folder, is why it is empty.
    return { title: t('filters.emptyTitle'), description: t('filters.emptyDescription'), onClear: clear }
  }, [filters, setFilters, canCollaborate, t, query, semanticActive, levelFiles, levelOccupied])
}
