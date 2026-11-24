'use client'

import type { JSX, ReactNode } from 'react'
import { CircleHelp, FolderInput, FolderPlus, ListChecks, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { SectionLevelTools, useSectionNewFolder, useSectionToolTier } from '@/components/shell/project-section-frame'
import { FileSearchField, TOOL_ROW_SEARCH_CLASS } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'

export interface NormsToolRowProps {
  phone: boolean
  search: string
  onSearch: (search: string) => void
  upload?: ReactNode
  onFromShelf?: () => void
  onNewTopic?: () => void
  onReviewPending?: () => void
  topic?: { name: string; onRename: () => void; onDelete: () => void }
  onGuide: () => void
}

export function NormsToolRow({ phone, search, onSearch, upload, onFromShelf, onNewTopic, onReviewPending, topic, onGuide }: NormsToolRowProps): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const tFiles = useTranslations(filesCopy)
  const tier = useSectionToolTier()
  const sectionNewTopic = useSectionNewFolder()
  const newTopic = onNewTopic ?? sectionNewTopic
  const narrow = phone || tier === 'narrow'
  const entries: ActionMenuEntry[] = [
    ...(onReviewPending
      ? [{ type: 'item' as const, id: 'review-pending', label: t('norms.review'), icon: ListChecks, onSelect: onReviewPending, testId: 'base-knowledge-review-pending' }]
      : []),
    ...(newTopic
      ? [{ type: 'item' as const, id: 'new-topic', label: t('folders.newTopic'), icon: FolderPlus, onSelect: newTopic, testId: 'base-knowledge-new-topic' }]
      : []),
    ...(topic
      ? [
          { type: 'item' as const, id: 'rename-topic', label: t('folders.renameTopic', { name: topic.name }), icon: Pencil, onSelect: topic.onRename, testId: 'base-knowledge-rename-topic' },
          { type: 'item' as const, id: 'delete-topic', label: t('folders.deleteTopic', { name: topic.name }), icon: Trash2, variant: 'destructive' as const, onSelect: topic.onDelete, testId: 'base-knowledge-delete-topic' },
        ]
      : []),
    ...(onFromShelf
      ? [{ type: 'item' as const, id: 'from-shelf', label: t('fromShelf'), icon: FolderInput, onSelect: onFromShelf, testId: 'base-knowledge-from-shelf' }]
      : []),
    { type: 'item', id: 'guide', label: t('guide.toggle'), icon: CircleHelp, onSelect: onGuide, testId: 'base-knowledge-guide-toggle' },
  ]
  const field = (
    <FileSearchField
      className={phone ? 'flex-1' : TOOL_ROW_SEARCH_CLASS}
      size={phone ? 'default' : 'sm'}
      value={search}
      onChange={onSearch}
      onSubmit={() => onSearch(search)}
      onClear={() => onSearch('')}
      placeholder={phone ? t('filter.searchShort') : t('filter.search')}
      searchLabel={t('filter.searchLabel')}
      resetLabel={t('filter.clear')}
    />
  )
  const more = (
    <ActionMenu
      mode="dropdown"
      entries={entries}
      trigger={
        <Button type="button" variant="secondary" size="icon" aria-label={tFiles('workspace.more')} data-testid="base-knowledge-more">
          <MoreHorizontal aria-hidden />
        </Button>
      }
    />
  )
  if (phone) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2" data-testid="base-knowledge-controls">
        {field}
        {more}
      </div>
    )
  }
  return (
    <div className={cn('flex min-w-0 flex-1 items-center [&_[data-slot=button]]:text-sm', narrow ? 'gap-2' : 'gap-3')} data-testid="base-knowledge-controls">
      {field}
      <div className={cn('ml-auto flex shrink-0 items-center', narrow ? 'gap-2' : 'gap-3')}>
        <SectionLevelTools />
        {upload}
        {more}
      </div>
    </div>
  )
}
