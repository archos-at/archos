'use client'

import type { JSX, ReactNode } from 'react'
import { CircleHelp, FolderInput, FolderPlus, MoreHorizontal } from 'lucide-react'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SectionLevelTools, useSectionNewFolder, useSectionToolTier } from '@/components/shell/project-section-frame'
import { FileSearchField } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { filesCopy } from '@/i18n/namespaces/files'
import { OFFICE_WORK_KINDS } from '@/lib/base-knowledge/wire/vocab'
import { cn } from '@/lib/utils'
import type { Kind } from '../hooks/use-base-knowledge'

const ALL = 'all'

export interface NormsToolRowProps {
  phone: boolean
  search: string
  onSearch: (search: string) => void
  kind: Kind | null
  onKind: (kind: Kind | null) => void
  upload?: ReactNode
  onFromShelf?: () => void
  onNewTopic?: () => void
  onGuide: () => void
}

export function NormsToolRow({ phone, search, onSearch, kind, onKind, upload, onFromShelf, onNewTopic, onGuide }: NormsToolRowProps): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const tFiles = useTranslations(filesCopy)
  const tier = useSectionToolTier()
  const sectionNewTopic = useSectionNewFolder()
  const newTopic = onNewTopic ?? sectionNewTopic
  const narrow = phone || tier === 'narrow'
  const choose = (value: string): void => onKind(value === ALL ? null : (value as Kind))
  const kinds = [{ value: ALL, label: t('filter.kindAll') }, ...OFFICE_WORK_KINDS.map((value) => ({ value, label: t(`kind.${value}`) }))]
  const entries: ActionMenuEntry[] = [
    ...(narrow
      ? [
          { type: 'label' as const, label: t('column.kind') },
          { type: 'radio-group' as const, value: kind ?? ALL, onValueChange: choose, items: kinds },
          { type: 'separator' as const },
        ]
      : []),
    ...(newTopic
      ? [{ type: 'item' as const, id: 'new-topic', label: t('folders.newTopic'), icon: FolderPlus, onSelect: newTopic, testId: 'base-knowledge-new-topic' }]
      : []),
    ...(onFromShelf
      ? [{ type: 'item' as const, id: 'from-shelf', label: t('fromShelf'), icon: FolderInput, onSelect: onFromShelf, testId: 'base-knowledge-from-shelf' }]
      : []),
    { type: 'item', id: 'guide', label: t('guide.toggle'), icon: CircleHelp, onSelect: onGuide, testId: 'base-knowledge-guide-toggle' },
  ]
  const field = (
    <FileSearchField
      className={phone ? 'flex-1' : 'min-w-40 max-w-[28rem] flex-1'}
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
      {!narrow && (
        <Select value={kind ?? ALL} onValueChange={choose}>
          <SelectTrigger size="sm" className="w-40 shrink-0" aria-label={t('column.kind')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className={cn('ml-auto flex shrink-0 items-center', narrow ? 'gap-2' : 'gap-3')}>
        <SectionLevelTools />
        {upload}
        {more}
      </div>
    </div>
  )
}
