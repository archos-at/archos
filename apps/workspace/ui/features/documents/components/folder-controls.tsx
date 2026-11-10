'use client'

/**
 * The folder level's two small controls, beside the drill-down in `folder-navigation.tsx`: „Ordner anlegen“ as a
 * popover form where the reader stands, and a folder's own ⋯ where the caller supplies no menu of its own.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { Folder, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import type { FolderItem } from './project-file-workspace'

interface FolderLevelProps {
  currentFolderId: string | null
  onCreateFolder: (name: string, parentId?: string) => Promise<boolean>
}

/**
 * "New folder" as a popover form: name it where you stand, Enter creates it in
 * the CURRENT level. Failure keeps the popover open with the typed name — the
 * workspace surfaces the error toast.
 */
export function NewFolderControl({
  currentFolderId,
  onCreateFolder,
}: FolderLevelProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const commit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || isCreating) return
    setIsCreating(true)
    const ok = await onCreateFolder(trimmed, currentFolderId ?? undefined)
    setIsCreating(false)
    if (ok) {
      setName('')
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={(next) => (isCreating ? undefined : setOpen(next))}>
      <PopoverTrigger asChild>
        {/* Tonal: it creates, and as bare words „Ordner anlegen“ read as a label. Its fill ends on the column's edge, under Hochladen's. */}
        <Button type="button" variant="secondary" size="sm" className="gap-1.5" title={t('folders.newFolder')}>
          <FolderPlus className="size-4" aria-hidden />
          {/* A glyph on a phone inside a folder, where the path needs the width; at the root, its words. */}
          <span className={cn(currentFolderId !== null && 'phone:sr-only')}>{t('folders.newFolder')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <InputGroup>
          <InputGroupAddon align="start" className="left-2">
            <Folder aria-hidden />
          </InputGroupAddon>
          <Input
            autoFocus
            value={name}
            disabled={isCreating}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commit()
            }}
            placeholder={t('folders.namePlaceholder')}
            aria-label={t('folders.newFolderName')}
            aria-busy={isCreating}
            className="h-8 rounded-control pl-8 pr-8"
          />
          {isCreating && (
            <InputGroupAddon align="end">
              <Spinner size="sm" label={t('folders.creating')} />
            </InputGroupAddon>
          )}
        </InputGroup>
      </PopoverContent>
    </Popover>
  )
}

export function FolderActionsMenu({
  folder,
  onStartRename,
  onDeleteFolder,
}: {
  folder: FolderItem
  onStartRename: () => void
  onDeleteFolder: (folderId: string) => Promise<boolean>
}): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('folders.actionsFor', { name: folder.name })}
          title={t('folders.actions')}
          className="hover:bg-accent focus-visible:ring-ring flex size-8 shrink-0 items-center justify-center rounded-full transition-opacity duration-snap ease-out focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 pointer-coarse:size-11 pointer-coarse:opacity-100 motion-reduce:transition-none md:opacity-0 md:group-hover:opacity-100 data-[state=open]:opacity-100"
          data-testid={`folder-actions-${folder.id}`}
        >
          <MoreHorizontal className="size-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={onStartRename}>
          <Pencil className="size-4" aria-hidden />
          {t('folders.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => void onDeleteFolder(folder.id)}
          data-testid={`folder-delete-${folder.id}`}
        >
          <Trash2 className="size-4" aria-hidden />
          {t('folders.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
