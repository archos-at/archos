'use client'

import type { JSX, ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadMore } from '@/components/ui/load-more'
import { SectionLabel } from '@/components/ui/section-label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import type { BaseKnowledgeEntry, BaseKnowledgeFolders, BaseKnowledgeList, BulkEntriesBody, EntryCounts } from '@/lib/base-knowledge/wire'
import type { Attention, BaseKnowledgeFilters } from '../hooks/use-base-knowledge'
import { EntryTable } from './entry-table'

const ATTENTION: { key: Attention | null; label: 'filter.all' | 'filter.proposed' | 'filter.newerEdition' | 'filter.checkDue'; count: keyof EntryCounts }[] = [
  { key: null, label: 'filter.all', count: 'all' },
  { key: 'proposed', label: 'filter.proposed', count: 'proposed' },
  { key: 'newer_edition', label: 'filter.newerEdition', count: 'newerEdition' },
  { key: 'check_due', label: 'filter.checkDue', count: 'checkDue' },
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
  labelled?: boolean
}

function AttentionFilters({ counts, value, onChange }: { counts: EntryCounts; value: Attention | null; onChange: (next: Attention | null) => void }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('column.status')} data-testid="base-knowledge-attention">
      {ATTENTION.map(({ key, label, count }) => (
        <Toggle key={label} variant="chip" size="sm" className="text-name" pressed={value === key} onPressedChange={() => onChange(key)}>
          <Check className="hidden size-3.5 in-data-[state=on]:block" aria-hidden />
          {t(label)}
          <span className="text-muted-foreground tabular-nums">{counts[count]}</span>
        </Toggle>
      ))}
    </div>
  )
}

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
    <section aria-label={t('list.label')} className="flex min-w-0 flex-col gap-2" data-testid="base-knowledge-list">
      {selected.size > 0 ? (
        <SelectionBar count={selected.size} onClear={props.onClearSelection}>
          <Button size="sm" variant="secondary" onClick={() => props.onBulk({ type: 'check', result: 'current' })}>
            {t('bulk.check')}
          </Button>
          <MoveTo folders={folders} onMove={(folderId) => props.onBulk({ type: 'move', folderId })} />
          <Button size="sm" variant="ghost" className="text-error" onClick={() => props.onBulk({ type: 'remove' })}>
            {t('bulk.remove')}
          </Button>
        </SelectionBar>
      ) : (
        <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          {props.labelled && (
            <SectionLabel as="h2" className="px-0">
              {t('list.label')}
            </SectionLabel>
          )}
          <AttentionFilters counts={list.counts} value={filters.attention} onChange={(attention) => onFilters({ attention })} />
        </div>
      )}
      {list.entries.length === 0 ? (
        <EmptyState
          variant="bare"
          title={filtered ? t('empty.filtered') : t('empty.folder')}
          action={
            filtered ? (
              <Button variant="secondary" size="sm" onClick={props.onReset}>
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
    </section>
  )
}

function SelectionBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  return (
    <div className="bg-desk flex min-h-11 flex-wrap items-center gap-2 rounded-surface px-3 py-1.5" data-testid="data-toolbar-selection">
      <p className="text-sm font-medium tabular-nums">{t('bulk.selected', { count })}</p>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {children}
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="size-3.5" aria-hidden />
          {t('bulk.clear')}
        </Button>
      </div>
    </div>
  )
}
