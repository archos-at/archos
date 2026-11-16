'use client'

import type { JSX } from 'react'
import { RotateCcw, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslations } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'
import type { QuarantineQueueItem } from '@/adapters/api/upload-screening-client'

export const FINDING_FILTERS = [
  'term',
  'iban',
  'at_svnr',
  'credit_card',
  'de_svnr',
  'de_tax_id',
  'other',
  'unscreened',
] as const
export type FindingFilter = 'all' | (typeof FINDING_FILTERS)[number]

export function findingsOfItem(item: QuarantineQueueItem): ReadonlySet<FindingFilter> {
  const kinds = new Set<FindingFilter>((item.verdict?.reasons ?? []).map((reason) => reason.kind))
  if (item.held === 'unscreened') kinds.add('unscreened')
  return kinds
}

export interface QuarantineSelectionProps {
  counts: ReadonlyMap<FindingFilter, number>
  filter: FindingFilter
  onFilterChange: (filter: FindingFilter) => void
  shown: number
  selected: number
  limit: number
  onSelectAll: (all: boolean) => void
  onClear: () => void
  onRelease: () => void
  onDelete: () => void
  onRecheck: () => void
}

export function QuarantineSelection({
  counts,
  filter,
  onFilterChange,
  shown,
  selected,
  limit,
  onSelectAll,
  onClear,
  onRelease,
  onDelete,
  onRecheck,
}: QuarantineSelectionProps): JSX.Element {
  const t = useTranslations(organizationCopy)
  const pickable = Math.min(shown, limit)
  const master = selected === 0 ? false : selected >= pickable ? true : 'indeterminate'
  const offered = FINDING_FILTERS.filter((kind) => (counts.get(kind) ?? 0) > 0)

  return (
    <div className="flex flex-col gap-2" data-testid="quarantine-selection">
      {offered.length > 1 && (
        <ToggleGroup
          type="single"
          size="sm"
          segmented
          value={filter}
          onValueChange={(value) => value && onFilterChange(value as FindingFilter)}
          aria-label={t('quarantine.filterLabel')}
          className="flex-wrap"
          data-testid="quarantine-filter"
        >
          <ToggleGroupItem value="all" data-testid="quarantine-filter-all">
            {t('quarantine.filter.all')}
          </ToggleGroupItem>
          {offered.map((kind) => (
            <ToggleGroupItem
              key={kind}
              value={kind}
              className="tabular-nums"
              data-testid={`quarantine-filter-${kind}`}
            >
              {t(`quarantine.filter.${kind}`)} · {counts.get(kind)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 px-4">
        <Checkbox
          checked={master}
          onCheckedChange={(checked) => onSelectAll(checked === true)}
          aria-label={t('quarantine.selectAll')}
          data-testid="quarantine-select-all"
        />
        <p className="text-muted-foreground min-w-0 flex-1 text-sm tabular-nums" role="status">
          {selected > 0 ? t('quarantine.selected', { count: selected }) : t('quarantine.selectAll')}
          {selected > 0 && shown > limit && selected >= limit && (
            <span className="block text-xs" data-testid="quarantine-selection-limit">
              {t('quarantine.selectionLimit', { limit })}
            </span>
          )}
        </p>
        {selected > 0 && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRecheck}
              title={t('quarantine.recheckHint')}
              data-testid="quarantine-recheck-selected"
            >
              <RotateCcw className="size-4" aria-hidden />
              {t('quarantine.recheck')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRelease}
              data-testid="quarantine-release-selected"
            >
              {t('quarantine.release')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              data-testid="quarantine-delete-selected"
            >
              <Trash2 className="size-4" aria-hidden />
              {t('quarantine.delete')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClear}
              aria-label={t('quarantine.clearSelection')}
              data-testid="quarantine-clear-selection"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
