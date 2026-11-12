'use client'

/**
 * The standards at one level: what needs a person as filters with their counts
 * (to confirm, check due, text not read), a search and a kind, the bulk bar
 * once rows are selected, the table, and the next page. The server narrows and
 * counts (`listing.ts`); this draws what it answered.
 */

import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { Chip, ChipCount } from '@/components/ui/chip'
import { DataToolbar } from '@/components/ui/data-toolbar'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadMore } from '@/components/ui/load-more'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import type { BaseKnowledgeEntry, BaseKnowledgeFolders, BaseKnowledgeList, BulkEntriesBody, EntryCounts } from '@/lib/base-knowledge/wire'
import { OFFICE_WORK_KINDS } from '@/lib/base-knowledge/wire/vocab'
import type { Attention, BaseKnowledgeFilters, Kind } from '../hooks/use-base-knowledge'
import { EntryTable } from './entry-table'

const ALL = 'all'
const ATTENTION: { key: Attention | null; label: 'filter.all' | 'filter.proposed' | 'filter.checkDue' | 'filter.metadataOnly'; count: keyof EntryCounts }[] = [
  { key: null, label: 'filter.all', count: 'all' },
  { key: 'proposed', label: 'filter.proposed', count: 'proposed' },
  { key: 'check_due', label: 'filter.checkDue', count: 'checkDue' },
  { key: 'metadata_only', label: 'filter.metadataOnly', count: 'metadataOnly' },
]

interface EntryListProps {
  list: BaseKnowledgeList
  folders: BaseKnowledgeFolders
  filters: BaseKnowledgeFilters
  onFilters: (patch: Partial<BaseKnowledgeFilters>) => void
  onReset: () => void
  selected: ReadonlySet<string>
  onSelect: (ids: string[], on: boolean) => void
  onClearSelection: () => void
  onBulk: (action: BulkEntriesBody['action']) => void
  onOpen: (entry: BaseKnowledgeEntry) => void
  loadingMore: boolean
  onLoadMore: () => void
}

function AttentionFilters({ counts, value, onChange }: { counts: EntryCounts; value: Attention | null; onChange: (next: Attention | null) => void }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('column.status')} data-testid="base-knowledge-attention">
      {ATTENTION.map(({ key, label, count }) => (
        <Chip key={label} asChild interactive variant={value === key ? 'default' : 'outline'}>
          <button type="button" aria-pressed={value === key} onClick={() => onChange(key)}>
            {t(label)}
            <ChipCount count={counts[count]} />
          </button>
        </Chip>
      ))}
    </div>
  )
}

/** Where a selection can move to: the top level and every folder, by path. */
function MoveTo({ folders, onMove }: { folders: BaseKnowledgeFolders; onMove: (folderId: string) => void }): JSX.Element | null {
  const t = useTranslations(baseKnowledgeCopy)
  if (!folders.rootId) return null
  return (
    <Select value="" onValueChange={onMove}>
      <SelectTrigger size="sm" className="w-44" aria-label={t('bulk.move')}>
        <SelectValue placeholder={t('bulk.move')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={folders.rootId}>{t('detail.rootFolder')}</SelectItem>
        {folders.folders.map((folder) => (
          <SelectItem key={folder.id} value={folder.id}>
            {folder.path.split('/').slice(1).join(' / ')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function EntryList(props: EntryListProps): JSX.Element {
  const { list, folders, filters, onFilters, selected } = props
  const t = useTranslations(baseKnowledgeCopy)
  const filtered = filters.attention !== null || filters.kind !== null || filters.search.trim() !== ''
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="base-knowledge-list">
      <AttentionFilters counts={list.counts} value={filters.attention} onChange={(attention) => onFilters({ attention })} />
      <DataToolbar
        searchValue={filters.search}
        onSearchChange={(search) => onFilters({ search })}
        searchPlaceholder={t('filter.search')}
        searchLabel={t('filter.searchLabel')}
        clearLabel={t('filter.clear')}
        filters={
          <Select value={filters.kind ?? ALL} onValueChange={(kind) => onFilters({ kind: kind === ALL ? null : (kind as Kind) })}>
            <SelectTrigger className="w-40" aria-label={t('column.kind')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filter.kindAll')}</SelectItem>
              {OFFICE_WORK_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(`kind.${kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        selectedCount={selected.size}
        selectionLabel={(count) => t('bulk.selected', { count })}
        clearSelectionLabel={t('bulk.clear')}
        onClearSelection={props.onClearSelection}
        selectionActions={
          <>
            <Button size="sm" variant="outline" onClick={() => props.onBulk({ type: 'check', result: 'current' })}>
              {t('bulk.check')}
            </Button>
            <MoveTo folders={folders} onMove={(folderId) => props.onBulk({ type: 'move', folderId })} />
            <Button size="sm" variant="ghost" className="text-error" onClick={() => props.onBulk({ type: 'remove' })}>
              {t('bulk.remove')}
            </Button>
          </>
        }
      />
      {list.entries.length === 0 ? (
        <EmptyState
          variant="bare"
          title={filtered ? t('empty.filtered') : t('empty.folder')}
          action={
            filtered ? (
              <Button variant="outline" size="sm" onClick={props.onReset}>
                {t('empty.clearFilters')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <EntryTable
          entries={list.entries}
          canManage={list.canManage}
          selected={selected}
          onToggle={(id, on) => props.onSelect([id], on)}
          onToggleAll={(on) => props.onSelect(list.entries.map((entry) => entry.id), on)}
          onOpen={props.onOpen}
        />
      )}
      <LoadMore
        hasMore={list.nextCursor !== null}
        loading={props.loadingMore}
        onLoadMore={props.onLoadMore}
        loadMoreLabel={t('loadMore')}
        loadingLabel={t('loadingMore')}
        failedLabel={t('loadError')}
      />
    </div>
  )
}
