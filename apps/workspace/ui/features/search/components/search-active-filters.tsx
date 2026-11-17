'use client'

import type { JSX } from 'react'

import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { searchCopy } from '@/i18n/namespaces/search'
import { useSearchLabels } from '../hooks/use-search-labels'
import { activeFilters, clearFilters } from '../lib/active-filters'
import type { SearchUrlState } from '../lib/search-url'
import { ActiveFilters, RemovableChip } from './search-atoms'

export function SearchActiveFilters({
  state,
  onChange,
  projectName,
}: {
  state: SearchUrlState
  onChange: (next: SearchUrlState) => void
  projectName: (id: string) => string | null
}): JSX.Element | null {
  const t = useTranslations(searchCopy, 'filters')
  const labels = useSearchLabels()
  const filters = activeFilters(state).filter((filter) => !(state.view === 'register' && filter.id === 'currentOnly'))
  if (filters.length === 0) return null
  return (
    <ActiveFilters>
      {filters.map((filter) => {
        const label = labels.activeFilter(filter, projectName)
        return <RemovableChip key={filter.id} label={label} removeLabel={t('remove', { label })} onRemove={() => onChange(filter.next)} />
      })}
      {filters.length > 1 ? (
        <Button type="button" variant="link" size="sm" onClick={() => onChange(clearFilters(state))} data-testid="search-clear-filters">
          {/* On a phone the short words keep it on the chips' line rather than a line of its own. */}
          <span className="max-sm:hidden">{t('clearAll')}</span>
          <span className="sm:hidden">{t('clearAllShort')}</span>
        </Button>
      ) : null}
    </ActiveFilters>
  )
}
