'use client'

import type { JSX } from 'react'
import type { ReactNode } from 'react'
import { useId } from 'react'
import { ArrowDownNarrowWide, ArrowUpNarrowWide, SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { CountPill } from '@/components/ui/count-pill'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SectionLabel } from '@/components/ui/section-label'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { DocumentKind } from '../document-kind'
import {
  FILE_KIND_FILTERS,
  FILE_STATUS_GROUPS,
  NO_FILE_FILTERS,
  activeFilterCount,
  toggleIn,
  type AssignmentFilter,
  type FileFilters,
  type FileStatusGroup,
  type TagOption,
} from '../lib/file-filters'
import { defaultDirectionFor, type FileSort, type FileSortKey } from '../lib/file-sort'

export interface FileFilterMenuProps {
  canCollaborate: boolean
  filters: FileFilters
  onFiltersChange: (next: FileFilters) => void
  sort: FileSort
  onSortChange: (next: FileSort) => void
  sortDisabled?: boolean
  tagOptions?: readonly TagOption[]
  compact?: boolean
  defaultOpen?: boolean
}

const SORT_KEYS: readonly FileSortKey[] = ['added', 'name', 'status', 'size']

const ASSIGNMENT_FILTERS: readonly AssignmentFilter[] = ['all', 'mine', 'unassigned']

const ASSIGNMENT_LABEL_KEY: Record<AssignmentFilter, string> = {
  all: 'assignment.filterAll',
  mine: 'assignment.filterMine',
  unassigned: 'assignment.filterUnassigned',
}

export function FileFilterMenu({
  canCollaborate,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  sortDisabled = false,
  tagOptions = [],
  compact = false,
  defaultOpen,
}: FileFilterMenuProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const count = activeFilterCount(filters, canCollaborate)

  const setKinds = (kind: DocumentKind) =>
    onFiltersChange({ ...filters, kinds: toggleIn(filters.kinds, kind, FILE_KIND_FILTERS) })
  const setStatuses = (group: FileStatusGroup) =>
    onFiltersChange({
      ...filters,
      statuses: toggleIn(filters.statuses, group, FILE_STATUS_GROUPS),
    })

  const setTags = (key: string) =>
    onFiltersChange({
      ...filters,
      tags: toggleIn(filters.tags, key, tagOptions.map((option) => option.key)),
    })

  const DirectionIcon = sort.direction === 'asc' ? ArrowUpNarrowWide : ArrowDownNarrowWide

  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size={compact ? 'icon' : 'sm'}
          className={compact ? 'relative shrink-0' : 'gap-2'}
          data-testid="file-filter-menu-trigger"
          aria-label={count > 0 ? t('filters.labelActive', { count }) : t('filters.label')}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          {!compact && t('filters.label')}
          {count > 0 && (
            <CountPill
              tone="attention"
              aria-hidden
              className={compact ? 'absolute -right-1.5 -top-1.5' : undefined}
              data-testid="file-filter-count"
              count={count}
            />
          )}
        </Button>
      </PopoverTrigger>
      {/* Five sections is taller than a short laptop's viewport with the
          header above it, and a popover that runs off the bottom of the screen
          hides the reset. It scrolls inside itself rather than growing. */}
      <PopoverContent
        align="end"
        collisionPadding={16}
        className="max-h-[min(70dvh,34rem)] w-72 max-w-[calc(100vw-2rem)] space-y-4 overflow-y-auto p-4"
        data-testid="file-filter-menu"
      >
        {!sortDisabled && (
          <FilterSection label={t('filters.sortLabel')}>
            <div className="flex items-center gap-1.5">
              <ToggleGroup
                type="single"
                value={sort.key}
                onValueChange={(value) => {
                  if (SORT_KEYS.includes(value as FileSortKey)) {
                    const key = value as FileSortKey
                    onSortChange({ key, direction: defaultDirectionFor(key) })
                  }
                }}
                segmented
                size="sm"
                aria-label={t('filters.sortLabel')}
              >
                {SORT_KEYS.map((key) => (
                  <ToggleGroupItem key={key} value={key} className="px-2 text-xs whitespace-nowrap">
                    {t(`list.columns.${key}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1.5 w-full justify-start gap-2 px-2 text-xs font-normal"
              onClick={() =>
                onSortChange({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
              }
              data-testid="file-filter-direction"
            >
              <DirectionIcon className="size-3.5" aria-hidden />
              {t(sort.direction === 'asc' ? 'filters.ascending' : 'filters.descending')}
            </Button>
          </FilterSection>
        )}

        {canCollaborate && (
          <>
            <Separator />
            <FilterSection label={t('assignment.responsible')}>
              <ToggleGroup
                type="single"
                value={filters.assignment}
                onValueChange={(value) => {
                  if (value === 'all' || value === 'mine' || value === 'unassigned') {
                    onFiltersChange({ ...filters, assignment: value })
                  }
                }}
                segmented
                size="sm"
                aria-label={t('assignment.responsible')}
              >
                {ASSIGNMENT_FILTERS.map((key) => (
                  <ToggleGroupItem key={key} value={key} className="px-2 text-xs">
                    {t(ASSIGNMENT_LABEL_KEY[key])}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FilterSection>
          </>
        )}

        <Separator />
        {/* Provenance, and deliberately its own section rather than an eighth
            Dateityp. The authorship filter answers who WROTE the file, which ANDs with
            every other filter here — the lead looking for the reports nobody
            has taken on yet needs `Unvergeben` and the authorship filter at once, and a
            value inside the kind list would have made that unaskable. */}
        <FilterSection label={t('filters.originLabel')}>
          <CheckRow
            id="file-filter-agent-authored"
            checked={filters.agentAuthoredOnly}
            onChange={() =>
              onFiltersChange({ ...filters, agentAuthoredOnly: !filters.agentAuthoredOnly })
            }
            label={t('authorship.filter')}
          />
          {/* „Freigabe ausstehend" sits with the authorship filter rather than under
              Status, and the two sections are not the same question: Status is
              where a document is in the INGESTION pipeline, this is whether the
              office has asserted its content (ADR-0054). It ANDs with everything
              else here, which is the query the lead clearing a queue before an
              Einreichung actually asks. */}
          <CheckRow
            id="file-filter-review-pending"
            checked={filters.reviewPendingOnly}
            onChange={() =>
              onFiltersChange({ ...filters, reviewPendingOnly: !filters.reviewPendingOnly })
            }
            label={t('lifecycle.filter')}
          />
        </FilterSection>

        <Separator />
        {/* The two controls here that WIDEN, together and worded alike, under
            „Auch zeigen" so nobody reads either as a narrowing. A retired
            document is not in the listing at all (`lifecycle = 'active'` is in
            the query), so this is the only way back to one. An older Fassung is
            one entry with its current one (ADR-0099) and comes back beside it.
            Each used to sit in a different section, one of them a heading and a
            separator spent on a single checkbox. */}
        <FilterSection label={t('filters.alsoShowLabel')}>
          <CheckRow
            id="file-filter-include-archived"
            checked={filters.includeArchived}
            onChange={() =>
              onFiltersChange({ ...filters, includeArchived: !filters.includeArchived })
            }
            label={t('filters.alsoShow.retired')}
          />
          <CheckRow
            id="file-filter-older-revisions"
            checked={filters.showOlderRevisions}
            onChange={() =>
              onFiltersChange({ ...filters, showOlderRevisions: !filters.showOlderRevisions })
            }
            label={t('filters.alsoShow.olderRevisions')}
          />
        </FilterSection>

        <Separator />
        <FilterSection label={t('filters.statusLabel')}>
          {FILE_STATUS_GROUPS.map((group) => (
            <CheckRow
              key={group}
              id={`file-filter-status-${group}`}
              checked={filters.statuses.includes(group)}
              onChange={() => setStatuses(group)}
              label={t(`filters.status.${group}`)}
            />
          ))}
        </FilterSection>

        <Separator />
        <FilterSection label={t('filters.kindLabel')}>
          {FILE_KIND_FILTERS.map((kind) => (
            <CheckRow
              key={kind}
              id={`file-filter-kind-${kind}`}
              checked={filters.kinds.includes(kind)}
              onChange={() => setKinds(kind)}
              label={t(`filters.kind.${kind}`)}
            />
          ))}
        </FilterSection>

        {tagOptions.length > 0 && (
          <>
            <Separator />
            <FilterSection label={t('filters.tagLabel')}>
              {tagOptions.map((option, index) => (
                <CheckRow
                  key={option.key}
                  id={`file-filter-tag-${index}`}
                  checked={filters.tags.includes(option.key)}
                  onChange={() => setTags(option.key)}
                  label={option.label}
                />
              ))}
            </FilterSection>
          </>
        )}

        <Separator />
        {/* Disabled, not hidden: a reset that appears only once something is on
            moves the other controls under the cursor the moment a filter is
            pressed. */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={count === 0}
          onClick={() => onFiltersChange({ ...NO_FILE_FILTERS })}
          data-testid="file-filter-reset"
        >
          {t('filters.reset')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function FilterSection({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  const headingId = useId()
  return (
    <div className="space-y-1.5" role="group" aria-labelledby={headingId}>
      <SectionLabel as="h3" id={headingId}>
        {label}
      </SectionLabel>
      {children}
    </div>
  )
}

function CheckRow({
  id,
  checked,
  onChange,
  label,
}: {
  id: string
  checked: boolean
  onChange: () => void
  label: string
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 pointer-coarse:min-h-11">
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id} className="flex-1 cursor-pointer text-sm leading-none pointer-coarse:py-3">
        {label}
      </label>
    </div>
  )
}
