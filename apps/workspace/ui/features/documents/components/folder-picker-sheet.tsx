'use client'

import type { ComponentType, JSX } from 'react'
import { useMemo, useState } from 'react'
import { Check, Folder, FolderOpen } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SearchField } from '@/components/ui/search-field'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import type { FolderDestination } from '../lib/folder-path-label'

export const FOLDER_ROW =
  'hover:bg-hover focus-visible:ring-ring duration-snap flex min-h-11 w-full items-center gap-3 rounded-control px-2 py-2 text-left text-sm transition-colors ease-out focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none motion-reduce:transition-none'

export interface FolderPickerListProps {
  destinations: readonly FolderDestination[]
  currentFolderId?: string | null
  canPick?: (folderId: string | null) => boolean
  pending?: boolean
  onPick: (folderId: string | null, label: string) => void
  /** The scrolling list's own bound: a dialog of its own gives it most of the screen, a step inside another dialog less. */
  listClassName?: string
}

export function matching(
  destinations: readonly FolderDestination[],
  query: string
): readonly FolderDestination[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return destinations
  return destinations.filter(({ label }) => label.toLocaleLowerCase().includes(needle))
}

export function FolderPickerList({
  destinations,
  currentFolderId,
  canPick,
  pending = false,
  onPick,
  listClassName = 'max-h-[min(55dvh,26rem)]',
}: FolderPickerListProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const [query, setQuery] = useState('')
  const rows = useMemo(() => matching(destinations, query), [destinations, query])
  const allFiles = t('folders.allFiles')
  const searching = query.trim() !== ''
  const showRoot =
    !searching || allFiles.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())

  return (
    <div className="flex flex-col gap-3" data-testid="folder-picker-body">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={t('picker.search')}
        label={t('picker.search')}
        clearLabel={t('browser.resetSearch')}
      />
      <ul
        className={cn('-mx-2 overflow-y-auto overscroll-contain', listClassName)}
        aria-label={t('picker.list')}
        data-testid="folder-picker-list"
      >
        {showRoot && (
          <PickerRow
            label={allFiles}
            here={currentFolderId === null}
            disabled={pending || currentFolderId === null || canPick?.(null) === false}
            onPick={() => onPick(null, allFiles)}
            testId="folder-picker-root"
            root
          />
        )}
        {rows.map(({ folder, label }) => (
          <PickerRow
            key={folder.id}
            label={label}
            here={currentFolderId === folder.id}
            disabled={pending || currentFolderId === folder.id || canPick?.(folder.id) === false}
            onPick={() => onPick(folder.id, label)}
            testId={`folder-picker-${folder.id}`}
          />
        ))}
        {!showRoot && rows.length === 0 && (
          <li className="text-muted-foreground px-2 py-6 text-center text-sm">
            {t('picker.empty', { query: query.trim() })}
          </li>
        )}
      </ul>
    </div>
  )
}

export interface FolderPickerSheetProps extends Omit<FolderPickerListProps, 'listClassName'> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
}

export function FolderPickerSheet({
  open,
  onOpenChange,
  title,
  ...list
}: FolderPickerSheetProps): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-3"
        closeLabel={t('picker.close')}
        data-testid="folder-picker"
      >
        <DialogHeader>
          <DialogTitle className="pr-10 text-base leading-snug">{title}</DialogTitle>
          <DialogDescription className="sr-only">{t('picker.description')}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the search starts empty every time. */}
        <FolderPickerList {...list} />
      </DialogContent>
    </Dialog>
  )
}

export function PickerRow({
  label,
  here,
  disabled,
  onPick,
  testId,
  root = false,
  icon,
  hint,
}: {
  label: string
  here: boolean
  disabled: boolean
  onPick: () => void
  testId: string
  root?: boolean
  /** A row that is not a plain folder of the tree, such as a proposed one, says so with its own glyph. */
  icon?: ComponentType<{ className?: string }>
  hint?: string
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const Icon = here ? Check : (icon ?? (root ? FolderOpen : Folder))
  return (
    <li>
      <button data-attr="files-pick"
        type="button"
        disabled={disabled}
        onClick={onPick}
        aria-current={here ? 'true' : undefined}
        data-testid={testId}
        className={cn(
          FOLDER_ROW,
          here ? 'text-muted-foreground' : 'text-foreground disabled:opacity-50'
        )}
      >
        <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col break-words">
          <span>{label}</span>
          {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
        </span>
        {here && <span className="text-muted-foreground shrink-0 text-xs">{t('picker.here')}</span>}
      </button>
    </li>
  )
}
