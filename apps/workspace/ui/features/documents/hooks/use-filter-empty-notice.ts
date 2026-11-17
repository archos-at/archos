'use client'

import { useMemo } from 'react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { FileItem } from '../file-types'
import { NO_FILE_FILTERS, activeFilterCount, type FileFilters } from '../lib/file-filters'
import type { useFileSearch } from './use-file-search'

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
  levelOccupied: boolean
}) {
  const t = useTranslations(filesCopy)
  const { query } = search
  const semanticActive = search.semantic.active
  return useMemo(() => {
    const clear = () => setFilters(NO_FILE_FILTERS)
    if (activeFilterCount(filters, canCollaborate) === 0) return null
    if (query.trim() !== '' || semanticActive) return null
    if (levelFiles.length > 0) return null
    if (!levelOccupied) return null
    if (filters.agentAuthoredOnly) {
      return { title: t('authorship.emptyTitle'), description: t('authorship.emptyDescription'), onClear: clear }
    }
    if (canCollaborate && filters.assignment !== 'all') {
      const title = filters.assignment === 'mine' ? t('assignment.emptyMine') : t('assignment.emptyUnassigned')
      return { title, description: t('assignment.emptyDescription'), onClear: clear }
    }
    return { title: t('filters.emptyTitle'), description: t('filters.emptyDescription'), onClear: clear }
  }, [filters, setFilters, canCollaborate, t, query, semanticActive, levelFiles, levelOccupied])
}
