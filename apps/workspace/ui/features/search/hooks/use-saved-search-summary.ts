'use client'

import { useMemo } from 'react'

import { useTranslations } from '@/i18n'
import { searchCopy } from '@/i18n/namespaces/search'
import type { SavedSearchView } from '@/lib/search/saved-search-client'
import type { ActiveFilter } from '../lib/active-filters'
import { savedSearchSummary } from '../lib/saved-search-summary'
import { useSearchLabels } from './use-search-labels'

const SELF_NAMING = new Set<ActiveFilter['value']['kind']>(['documentType', 'readState', 'flag'])

export function useSavedSearchSummary(): (item: SavedSearchView) => string {
  const t = useTranslations(searchCopy)
  const labels = useSearchLabels()
  return useMemo(() => {
    const words = {
      quote: (text: string) => t('saved.summaryText', { text }),
      register: t('views.register'),
      filter: (filter: ActiveFilter) =>
        SELF_NAMING.has(filter.value.kind) ? (labels.filterValue(filter, () => null) ?? '') : labels.activeFilter(filter, () => null),
      everything: t('saved.summaryEverything'),
    }
    return (item: SavedSearchView) => savedSearchSummary(item.query, words)
  }, [t, labels])
}
