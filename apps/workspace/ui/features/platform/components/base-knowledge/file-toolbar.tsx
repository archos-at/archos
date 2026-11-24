'use client'

import type { Dispatch, JSX, SetStateAction } from 'react'
import { MoreHorizontal, RefreshCw, RotateCcw } from 'lucide-react'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { DataToolbar } from '@/components/ui/data-toolbar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useDocClassLabel } from '@/features/platform/components/knowledge-atoms'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { DOC_CLASSES, type DocClass } from '@/lib/knowledge/doc-class'
import {
  ALL,
  type StateFilter,
  type TypeFilter,
} from '@/features/platform/lib/knowledge-file-filter'

interface KnowledgeFileToolbarProps {
  canManage: boolean
  query: string
  setQuery: Dispatch<SetStateAction<string>>
  typeFilter: TypeFilter
  setTypeFilter: Dispatch<SetStateAction<TypeFilter>>
  stateFilter: StateFilter
  setStateFilter: Dispatch<SetStateAction<StateFilter>>
  setOffset: Dispatch<SetStateAction<number>>
  selected: string[]
  setSelected: Dispatch<SetStateAction<string[]>>
  presentClasses: { cls: DocClass; count: number }[]
  isSyncing: boolean
  isReingesting: boolean
  reingestable: string[]
  setPendingReingest: Dispatch<SetStateAction<string[]>>
  setSyncConfirmOpen: Dispatch<SetStateAction<boolean>>
  onBulkReclassify: (nextClass: DocClass) => void
}

export function KnowledgeFileToolbar({
  canManage,
  query,
  setQuery,
  typeFilter,
  setTypeFilter,
  stateFilter,
  setStateFilter,
  setOffset,
  selected,
  setSelected,
  presentClasses,
  isSyncing,
  isReingesting,
  reingestable,
  setPendingReingest,
  setSyncConfirmOpen,
  onBulkReclassify,
}: KnowledgeFileToolbarProps): JSX.Element {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const docClassLabel = useDocClassLabel()
  const isBusy = isSyncing

  const overflowEntries: ActionMenuEntry[] = [
    {
      type: 'item',
      id: 'sync',
      label: t('knowledge.sync'),
      icon: RefreshCw,
      disabled: isBusy,
      onSelect: () => setSyncConfirmOpen(true),
      testId: 'knowledge-sync',
    },
    {
      type: 'item',
      id: 'reingest-issues',
      label: `${t('knowledgeAdmin.reingestIssues')} (${reingestable.length.toLocaleString(locale)})`,
      icon: RotateCcw,
      disabled: reingestable.length === 0 || isReingesting,
      onSelect: () => setPendingReingest(reingestable),
      testId: 'knowledge-reingest-issues',
    },
  ]

  const toolbarActions = canManage ? (
    <>
      {isSyncing || isReingesting ? (
        <span
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
          aria-live="polite"
        >
          <Spinner size="xs" aria-hidden />
          {isSyncing ? t('knowledge.syncing') : t('knowledgeAdmin.bulkReingestBusy')}
        </span>
      ) : null}
      <ActionMenu
        mode="dropdown"
        entries={overflowEntries}
        contentClassName="w-64"
        trigger={
          <Button
            variant="secondary"
            size="sm"
            className="w-8 px-0"
            aria-label={t('knowledgeAdmin.moreActions')}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        }
      />
    </>
  ) : null

  return (
    <DataToolbar
      searchValue={query}
      onSearchChange={(value) => {
        setQuery(value)
        setOffset(0)
      }}
      searchPlaceholder={t('knowledge.search')}
      searchLabel={t('knowledgeAdmin.searchLabel')}
      clearLabel={t('knowledgeAdmin.searchClear')}
      selectedCount={canManage ? selected.length : 0}
      selectionLabel={(count) => t('knowledgeAdmin.selectedCount', { count })}
      onClearSelection={() => setSelected([])}
      clearSelectionLabel={t('knowledgeAdmin.clearSelection')}
      selectionActions={
        <>
          <Select
            value=""
            onValueChange={(value) => onBulkReclassify(value as DocClass)}
          >
            <SelectTrigger
              size="sm"
              className="w-52 [&>span]:min-w-0 [&>span]:truncate"
              aria-label={t('knowledgeAdmin.bulkReclassify')}
            >
              <SelectValue placeholder={t('knowledgeAdmin.bulkReclassify')} />
            </SelectTrigger>
            <SelectContent>
              {DOC_CLASSES.map((option) => (
                <SelectItem key={option} value={option}>
                  {docClassLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPendingReingest([...selected])}
            loading={isReingesting}
          >
            {isReingesting ? null : <RotateCcw className="size-3.5" aria-hidden />}
            {isReingesting
              ? t('knowledgeAdmin.bulkReingestBusy')
              : t('knowledgeAdmin.bulkReingest')}
          </Button>
        </>
      }
      filters={
        <>
          <Select
            value={typeFilter}
            onValueChange={(value) => {
              setTypeFilter(value as TypeFilter)
              setOffset(0)
            }}
          >
            <SelectTrigger
              size="sm"
              className="min-w-40 flex-1 sm:w-48 sm:flex-none [&>span]:min-w-0 [&>span]:truncate"
              aria-label={t('knowledgeAdmin.typeFilterLabel')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('knowledge.docClassFilterAll')}</SelectItem>
              {/* The binding-vs-other split, as two entries of the type filter. */}
              <SelectItem value="binding">{t('knowledge.bindingTitle')}</SelectItem>
              <SelectItem value="other">{t('knowledge.otherTitle')}</SelectItem>
              <SelectSeparator />
              {presentClasses.map(({ cls, count }) => (
                <SelectItem key={cls} value={cls}>
                  {docClassLabel(cls)} ({count.toLocaleString(locale)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={stateFilter}
            onValueChange={(value) => {
              setStateFilter(value as StateFilter)
              setOffset(0)
            }}
          >
            <SelectTrigger
              size="sm"
              className="min-w-36 flex-1 sm:w-40 sm:flex-none"
              aria-label={t('knowledgeAdmin.stateFilterLabel')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('knowledgeAdmin.stateAll')}</SelectItem>
              <SelectItem value="issues">{t('knowledgeAdmin.stateIssues')}</SelectItem>
              <SelectItem value="pending">{t('knowledgeAdmin.statePending')}</SelectItem>
            </SelectContent>
          </Select>
        </>
      }
      actions={toolbarActions}
    />
  )
}
