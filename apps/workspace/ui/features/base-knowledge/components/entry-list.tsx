'use client'

import type { JSX, ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadMore } from '@/components/ui/load-more'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import type { BaseKnowledgeEntry, BaseKnowledgeFolders, BaseKnowledgeList, BulkEntriesBody, EntryCounts } from '@/lib/base-knowledge/wire'
import { OFFICE_WORK_KINDS } from '@/lib/base-knowledge/wire/vocab'
import { cn } from '@/lib/utils'
import type { Attention, BaseKnowledgeFilters, Kind } from '../hooks/use-base-knowledge'
import { EntryTable } from './entry-table'

const ATTENTION: { key: Attention | null; label: 'filter.all' | 'filter.proposed' | 'filter.newerEdition' | 'filter.checkDue'; count: keyof EntryCounts; asks: boolean }[] = [
  { key: null, label: 'filter.all', count: 'all', asks: false },
  { key: 'proposed', label: 'filter.proposed', count: 'proposed', asks: true },
  { key: 'newer_edition', label: 'filter.newerEdition', count: 'newerEdition', asks: true },
  { key: 'check_due', label: 'filter.checkDue', count: 'checkDue', asks: false },
]
const ALL = 'all'

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
  topics: readonly { id: string; name: string }[]
  onTopic: (folderId: string | null) => void
}

function AttentionFilters({ counts, value, onChange }: { counts: EntryCounts; value: Attention | null; onChange: (next: Attention | null) => void }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('column.status')} data-testid="base-knowledge-attention">
      {ATTENTION.map(({ key, label, count, asks }) => (
        <button
          key={label}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          data-testid={`base-knowledge-attention-${key ?? 'all'}`}
          className={cn(
            'text-name focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 pointer-coarse:h-11 transition-colors duration-quick focus-visible:outline-none focus-visible:ring-2',
            value === key ? 'bg-desk text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t(label)}
          <span
            className={cn(
              'text-meta rounded-full px-1.5 font-medium tabular-nums',
              asks && counts[count] > 0 ? 'bg-warning-subtle text-warning' : value === key ? 'bg-sheet' : 'bg-desk text-foreground'
            )}
          >
            {counts[count]}
          </span>
        </button>
      ))}
    </div>
  )
}

function TopicAndKind({
  topics,
  topic,
  onTopic,
  kind,
  onKind,
}: {
  topics: readonly { id: string; name: string }[]
  topic: string | null
  onTopic: (folderId: string | null) => void
  kind: Kind | null
  onKind: (kind: Kind | null) => void
}): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  return (
    <div className="ml-auto flex items-center gap-2">
      {topics.length > 0 && (
        <Select value={topic ?? ALL} onValueChange={(value) => onTopic(value === ALL ? null : value)}>
          <SelectTrigger size="sm" className="w-40" aria-label={t('column.topic')} data-testid="base-knowledge-topic-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filter.topicAll')}</SelectItem>
            {topics.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={kind ?? ALL} onValueChange={(value) => onKind(value === ALL ? null : (value as Kind))}>
        <SelectTrigger size="sm" className="w-36" aria-label={t('column.kind')} data-testid="base-knowledge-kind-filter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('filter.kindAll')}</SelectItem>
          {OFFICE_WORK_KINDS.map((value) => (
            <SelectItem key={value} value={value}>
              {t(`kind.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
  const filtered = filters.attention !== null || filters.kind !== null || filters.folderId !== null || filters.search.trim() !== ''
  const topicName = new Map(props.topics.map((topic) => [topic.id, topic.name]))
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
          <AttentionFilters counts={list.counts} value={filters.attention} onChange={(attention) => onFilters({ attention })} />
          <TopicAndKind topics={props.topics} topic={filters.folderId} onTopic={props.onTopic} kind={filters.kind} onKind={(kind) => onFilters({ kind })} />
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
          topicOf={props.topics.length > 0 ? (entry) => (entry.folderId ? (topicName.get(entry.folderId) ?? null) : null) : undefined}
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
