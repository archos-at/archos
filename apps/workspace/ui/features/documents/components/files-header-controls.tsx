'use client'

import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import Link from 'next/link'
import { FolderPlus, LayoutGrid, List, ListTodo, Mail, MoreHorizontal, SlidersHorizontal, Trash2 } from 'lucide-react'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { CountPill } from '@/components/ui/count-pill'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SectionLevelTools, useSectionNewFolder, useSectionToolTier } from '@/components/shell/project-section-frame'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { FileView } from '../hooks/use-view-preference'
import type { FileFilterMenuAnchor } from './file-filter-menu'
import { FileSearchField } from './file-search-bar'

export interface FilesHeaderControlsProps {
  phone: boolean
  view: FileView
  onViewChange: (view: FileView) => void
  binHref?: string
  openPointsHref?: string
  inboundMail?: { href: string; waiting: number | null }
  renderFilter: (compact: boolean, menu?: FileFilterMenuAnchor) => ReactNode
  filterCount?: number
  shelfSource?: 'project' | 'office' | 'personal'
  search: {
    value: string
    onChange: (value: string) => void
    onSubmit: () => void
    onClear: () => void
    opensSearch?: boolean
  }
  upload?: ReactNode
  moreEntries?: readonly ActionMenuEntry[]
  levelEntries?: readonly ActionMenuEntry[]
  advancedEntries?: readonly ActionMenuEntry[]
}

export function FilesHeaderControls({
  phone,
  view,
  onViewChange,
  binHref,
  openPointsHref,
  inboundMail,
  renderFilter,
  filterCount = 0,
  shelfSource,
  search,
  upload,
  moreEntries,
  levelEntries,
  advancedEntries,
}: FilesHeaderControlsProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const tier = useSectionToolTier()
  const newFolder = useSectionNewFolder()
  const [filterOpen, setFilterOpen] = useState(false)
  const choose = (value: string): void => {
    if (value === 'cards' || value === 'list') onViewChange(value)
  }
  const viewChoice: ActionMenuEntry = {
    type: 'radio-group',
    value: view,
    onValueChange: choose,
    items: [
      { value: 'cards', label: t('workspace.view.cards'), testId: 'files-view-cards' },
      { value: 'list', label: t('workspace.view.list'), testId: 'files-view-list' },
    ],
  }
  const viewToggle = (
    <ToggleGroup
      type="single"
      value={view}
      onValueChange={choose}
      segmented
      size="icon-sm" /* 28px squares on the track's 2px: 32px, the search field's and Hochladen's height */
      aria-label={t('workspace.view.label')}
    >
      <ToggleGroupItem value="cards" aria-label={t('workspace.view.cards')} title={t('workspace.view.cards')}>
        <LayoutGrid />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label={t('workspace.view.list')} title={t('workspace.view.list')}>
        <List />
      </ToggleGroupItem>
    </ToggleGroup>
  )
  const moreMenu = (entries: readonly ActionMenuEntry[], testId: string, marked = 0): JSX.Element => (
    <ActionMenu
      mode="dropdown"
      entries={[...entries]}
      trigger={
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="relative"
          aria-label={marked > 0 ? `${t('workspace.more')}, ${t('filters.labelActive', { count: marked })}` : t('workspace.more')}
          data-testid={testId}
        >
          <MoreHorizontal aria-hidden />
          {marked > 0 && <CountPill tone="attention" aria-hidden className="absolute -right-1.5 -top-1.5" count={marked} data-testid="file-filter-count" />}
        </Button>
      }
    />
  )
  const searchField = (className: string): JSX.Element => (
    <FileSearchField
      className={className}
      size={phone ? 'default' : 'sm'}
      value={search.value}
      onChange={search.onChange}
      onSubmit={search.onSubmit}
      onClear={search.onClear}
      placeholder={
        shelfSource && !phone
          ? t(`browser.searchPlaceholderIn.${shelfSource}`)
          : search.opensSearch && !phone
            ? t('browser.searchPlaceholderEverything')
            : t('browser.searchPlaceholder')
      }
      searchLabel={t('browser.searchLabel')}
      resetLabel={t('browser.resetSearch')}
    />
  )

  if (phone) {
    const entries: ActionMenuEntry[] = [
      ...(levelEntries && levelEntries.length > 0 ? [...levelEntries, { type: 'separator' as const }] : []),
      viewChoice,
      ...(openPointsHref
        ? [
            { type: 'separator' as const },
            {
              type: 'item' as const,
              id: 'open-points',
              label: t('openPoints.open'),
              icon: ListTodo,
              href: openPointsHref,
              testId: 'files-open-points',
            },
          ]
        : []),
      ...(inboundMail
        ? [
            { type: 'separator' as const },
            {
              type: 'item' as const,
              id: 'inbound-mail',
              label: t('inboundMail.open'),
              hint: inboundMail.waiting ? t('inboundMail.waitingLine', { count: inboundMail.waiting }) : undefined,
              icon: Mail,
              href: inboundMail.href,
              testId: 'files-inbound-mail',
            },
          ]
        : []),
      ...(binHref
        ? [
            { type: 'separator' as const },
            {
              type: 'item' as const,
              id: 'bin',
              label: t('workspace.openBin'),
              icon: Trash2,
              href: binHref,
              testId: 'files-open-bin',
            },
          ]
        : []),
      ...(moreEntries && moreEntries.length > 0 ? [{ type: 'separator' as const }, ...moreEntries] : []),
      ...(advancedEntries && advancedEntries.length > 0 ? [{ type: 'separator' as const }, ...advancedEntries] : []),
    ]
    return (
      <div className="flex min-w-0 items-center gap-2" data-testid="files-controls">
        {searchField('flex-1')}
        {renderFilter(true)}
        {moreMenu(entries, 'files-more')}
      </div>
    )
  }

  if (tier !== null) {
    const more: ActionMenuEntry[] = [
      viewChoice,
      { type: 'separator' },
      { type: 'item', id: 'filter', label: t('filters.label'), icon: SlidersHorizontal, onSelect: () => setFilterOpen(true), testId: 'files-filter-item' },
      ...(newFolder ? [{ type: 'item' as const, id: 'new-folder', label: t('folders.newFolder'), icon: FolderPlus, onSelect: newFolder, testId: 'files-new-folder-item' }] : []),
      ...(advancedEntries && advancedEntries.length > 0 ? [{ type: 'separator' as const }, ...advancedEntries] : []),
    ]
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 [&_[data-slot=button]]:text-sm" data-testid="files-controls">
        {searchField('min-w-40 flex-1')}
        <div className="flex shrink-0 items-center gap-2">
          <SectionLevelTools />
          {binHref && (
            <Button asChild variant="secondary" size="icon" aria-label={t('workspace.openBin')} title={t('workspace.openBin')}>
              <Link href={binHref} data-testid="files-open-bin">
                <Trash2 />
              </Link>
            </Button>
          )}
          {upload}
          <span className="relative inline-flex">
            {moreMenu(more, 'files-advanced', filterCount)}
            {renderFilter(true, {
              open: filterOpen,
              onOpenChange: setFilterOpen,
              anchor: <span aria-hidden className="pointer-events-none absolute inset-0" />,
            })}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-3 [&_[data-slot=button]]:text-sm" data-testid="files-controls">
      {viewToggle}
      {/* The open Anmerkungen of every document, for the Jour fixe: a page of its own, as the Papierkorb is. */}
      {openPointsHref && (
        <Button asChild variant="ghost" size="sm">
          <Link href={openPointsHref} data-testid="files-open-points">
            <ListTodo />
            {t('openPoints.open')}
          </Link>
        </Button>
      )}
      {/* Mail sent to the project's address, waiting until a person files it (ADR-0137). */}
      {inboundMail && (
        <Button asChild variant="ghost" size="sm">
          <Link
            href={inboundMail.href}
            data-testid="files-inbound-mail"
          >
            <Mail />
            {t('inboundMail.open')}
            {/* The name is the content, the visible words first (WCAG 2.5.3, label in name): an aria-label over
                „E-Mail-Eingang“ and the pill's figure never matched the text a speech user reads off the screen. */}
            {inboundMail.waiting ? (
              <>
                <CountPill count={inboundMail.waiting} tone="muted" aria-hidden />
                <span className="sr-only"> {t('inboundMail.waitingAria', { count: inboundMail.waiting })}</span>
              </>
            ) : null}
          </Link>
        </Button>
      )}
      {/* The Papierkorb: deleted folders, restorable until their purge (ADR-0088). */}
      {binHref && (
        <Button asChild variant="ghost" size="icon" aria-label={t('workspace.openBin')} title={t('workspace.openBin')}>
          <Link href={binHref} data-testid="files-open-bin">
            <Trash2 />
          </Link>
        </Button>
      )}
      {renderFilter(false)}
      {searchField('w-full sm:w-64 lg:w-72')}
      {upload}
      {advancedEntries && advancedEntries.length > 0 && moreMenu(advancedEntries, 'files-advanced')}
    </div>
  )
}
