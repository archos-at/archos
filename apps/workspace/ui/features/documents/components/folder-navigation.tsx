'use client'

import type { JSX } from 'react'
import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Folder } from 'lucide-react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group'
import { Item } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { AnimatePresence, motion, motionQuick } from '@/components/motion'
import { BackControl } from '@/components/shell/back-link'
import { ProjectSectionTabActions, useSectionPlaceSlot, useSectionTabActionsSlot, useSectionToolTier } from '@/components/shell/project-section-frame'
import { NewFolderDialog } from './new-folder-dialog'
import { FolderActionsMenu, NewFolderControl } from './folder-controls'

export { FolderActionsMenu } from './folder-controls'
import { FolderPlaceInHeader, folderPath } from './folder-trail'
import { FolderName } from './file-name'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { folderDragProps, useFolderDropTarget, type FileDropAim } from '../hooks/use-document-drag'
import { cn } from '@/lib/utils'
import { FOLDER_SHEET, FOLDER_WELL, FolderCardFrame } from './folder-card-frame'
import { FileTileBody, TileShell } from './file-tile'
import { FolderAccessMark, FolderReadOnlyBadge, useFolderOwnAccessLabel } from './folder-access-mark'
import { FolderReadState } from './folder-read-state'
import type { KnowledgeTally } from '../lib/folder-knowledge'
import type { FolderItem } from './project-file-workspace'

export interface FolderNavProps {
  folders: FolderItem[]
  currentFolderId: string | null
  onNavigate: (id: string | null) => void
  onCreateFolder: (name: string, parentId?: string) => Promise<boolean>
  onRenameFolder: (folderId: string, name: string) => Promise<boolean>
  onDeleteFolder: (folderId: string) => Promise<boolean>
}

export function FolderBreadcrumbRow({
  folders,
  currentFolderId,
  onNavigate,
  onCreateFolder,
  children,
  onDropDocument,
  onDropFolder,
  canAcceptFolder,
  readOnly = false,
  onDropFiles,
  onFileAim,
  mayWriteAt,
  rootToolsElsewhere = false,
  itemCount,
  emptyLevel = false,
  searching = false,
  rootLabel,
}: Pick<FolderNavProps, 'folders' | 'currentFolderId' | 'onNavigate'> & {
  rootLabel?: string
  searching?: boolean
  itemCount?: number
  emptyLevel?: boolean
  onCreateFolder?: FolderNavProps['onCreateFolder']
  children?: ReactNode
  rootToolsElsewhere?: boolean
  readOnly?: boolean
  onDropDocument?: (documentId: string, folderId: string | null) => void
  onDropFolder?: (draggedFolderId: string, parentId: string | null) => void
  canAcceptFolder?: (draggedFolderId: string, targetFolderId: string | null) => boolean
  onDropFiles?: DropFilesInFolder
  onFileAim?: (aim: FileDropAim | null) => void
  mayWriteAt?: (folderId: string | null) => boolean
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const allLabel = rootLabel ?? t('folders.allFiles')
  const path = useMemo(() => folderPath(folders, currentFolderId), [folders, currentFolderId])
  const crumb = (folderId: string | null, label: string, children: ReactNode) => (
    <CrumbDropTarget
      folderId={folderId}
      label={label}
      writable={mayWriteAt?.(folderId) ?? true}
      onDropDocument={onDropDocument}
      onDropFolder={onDropFolder}
      canAcceptFolder={canAcceptFolder}
      onDropFiles={onDropFiles}
      onFileAim={onFileAim}
      onSpringOpen={() => onNavigate(folderId)}
    >
      {children}
    </CrumbDropTarget>
  )

  const parent = currentFolderId === null ? undefined : path[path.length - 2]
  const parentLabel = parent ? parent.name : allLabel
  const tabSlot = useSectionTabActionsSlot()
  const placeSlot = useSectionPlaceSlot()
  const tier = useSectionToolTier()
  const folderInMenu = tabSlot && tier !== null && tier !== 'wide' && !readOnly && onCreateFolder !== undefined
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const openNewFolder = useCallback(() => setNewFolderOpen(true), [])
  const tools = (
    <>
      {children}
      {readOnly ? (
        <FolderReadOnlyBadge testId="folder-level-read-only" />
      ) : (
        onCreateFolder && !folderInMenu && <NewFolderControl currentFolderId={currentFolderId} onCreateFolder={onCreateFolder} />
      )}
    </>
  )
  const inRow = (
    <>
      <ProjectSectionTabActions newFolder={folderInMenu ? openNewFolder : undefined} emptyLevel={emptyLevel}>
        {tools}
      </ProjectSectionTabActions>
      {folderInMenu && (
        <NewFolderDialog open={newFolderOpen} onOpenChange={setNewFolderOpen} onCreate={(name) => onCreateFolder(name, currentFolderId ?? undefined)} />
      )}
    </>
  )

  if ((currentFolderId === null || searching) && tabSlot) return inRow
  if (searching || (currentFolderId === null && rootToolsElsewhere)) return null
  if (placeSlot && (tabSlot || rootToolsElsewhere)) {
    return (
      <>
        <FolderPlaceInHeader path={path} onNavigate={onNavigate} itemCount={itemCount} wrapStep={(folderId, label, step) => crumb(folderId, label, step)} />
        {tabSlot && inRow}
      </>
    )
  }

  return (
    <div
      className={cn('sticky top-0 z-10 flex listing-container shrink-0 items-center justify-between gap-2 bg-background px-4 pb-2 pt-4 phone:pt-2 md:px-8', currentFolderId === null && 'pb-0 pt-2')}
      data-testid="folder-breadcrumb-row"
    >
      <div className="flex min-w-0 items-center gap-2">
        {/*
          Up one level, as its own control rather than as a breadcrumb segment.

          The breadcrumb says where you ARE — it is a map, and reading a map to
          find the way out is work. Three levels deep the parent is a truncated
          word in the middle of a scrolling row, which is a 90px target for the
          single most common thing anyone does in a folder. Named, so it says
          what it will do before it is pressed.

          The same control the org-wide pages use to leave, deliberately: going
          up a level and leaving a page are one idea, and drawing them twice is
          how two lookalikes drift on the first token retune.
        */}
        {currentFolderId !== null &&
          crumb(
            parent?.id ?? null,
            parentLabel,
            <BackControl
              label={t('folders.backTo', { name: parentLabel })}
              onClick={() => onNavigate(parent?.id ?? null)}
              className="shrink-0 whitespace-nowrap pr-3"
              testId="folder-back"
            />
          )}
      <Breadcrumb aria-label={t('folders.breadcrumb')} className="min-w-0">
        <BreadcrumbList className="flex-nowrap overflow-x-auto">
          <BreadcrumbItem>
            {currentFolderId === null ? (
              <BreadcrumbPage className="sr-only" /* the tab above says it */>{allLabel}</BreadcrumbPage>
            ) : (
              crumb(
                null,
                allLabel,
                <BreadcrumbLink asChild>
                  <button data-attr="files-navigate"
                    type="button"
                    onClick={() => onNavigate(null)}
                    className="hover:text-foreground transition-colors rounded-inline whitespace-nowrap px-1"
                  >
                    {allLabel}
                  </button>
                </BreadcrumbLink>
              )
            )}
          </BreadcrumbItem>
          <AnimatePresence initial={false}>
            {path.map((folder, index) => (
              <Fragment key={folder.id}>
                <BreadcrumbSeparator>
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={motionQuick}
                  >
                    <ChevronRight className="size-3.5" aria-hidden />
                  </motion.span>
                </BreadcrumbSeparator>
                <BreadcrumbItem>
                  <motion.span
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={motionQuick}
                  >
                    {index === path.length - 1 ? (
                      <BreadcrumbPage className="block max-w-80 truncate text-sm font-medium" title={folder.name}>{folder.name}</BreadcrumbPage>
                    ) : (
                      crumb(
                        folder.id,
                        folder.name,
                        <BreadcrumbLink asChild>
                          <button data-attr="files-navigate"
                            type="button"
                            className="max-w-48 truncate hover:text-foreground transition-colors px-1"
                            title={folder.name}
                            onClick={() => onNavigate(folder.id)}
                          >
                            {folder.name}
                          </button>
                        </BreadcrumbLink>
                      )
                    )}
                  </motion.span>
                </BreadcrumbItem>
              </Fragment>
            ))}
          </AnimatePresence>
        </BreadcrumbList>
      </Breadcrumb>
      </div>
      {!rootToolsElsewhere /* a phone's are in its ⋯: here they were the same two a second time */ && <div className="flex shrink-0 items-center gap-3" /* tonal presses 12px apart */>{tools}</div>}
    </div>
  )
}

export interface FolderTileProps {
  folder: FolderItem
  itemCount: number
  lastModified?: string | null
  knowledge?: KnowledgeTally
  onOpen: (id: string) => void
  onRenameFolder: FolderNavProps['onRenameFolder']
  onDeleteFolder: FolderNavProps['onDeleteFolder']
  actions?: ReactNode
  editing?: boolean
  onEditingChange?: (editing: boolean) => void
  onDropDocument?: (documentId: string, folderId: string | null) => void
  onDropFolder?: (draggedFolderId: string, parentId: string | null) => void
  canAcceptFolder?: (draggedFolderId: string, targetFolderId: string | null) => boolean
  readOnly?: boolean
  onDropFiles?: DropFilesInFolder
  onFileAim?: (aim: FileDropAim | null) => void
}

export type DropFilesInFolder = (
  files: File[],
  info: { truncated: boolean; unreadable: number },
  folderId: string | null
) => void

export function dropRing(drop: { isOver: boolean; refuses: boolean }, inset = false): string | false {
  if (drop.refuses) return cn('ring-destructive ring-2', inset && 'ring-inset')
  return drop.isOver && cn('bg-accent ring-ring ring-2', inset && 'ring-inset')
}

function CrumbDropTarget({
  folderId,
  label,
  writable,
  onDropDocument,
  onDropFolder,
  canAcceptFolder,
  onDropFiles,
  onFileAim,
  onSpringOpen,
  children,
}: {
  folderId: string | null
  label: string
  onSpringOpen?: () => void
  writable: boolean
  onDropDocument?: (documentId: string, folderId: string | null) => void
  onDropFolder?: (draggedFolderId: string, parentId: string | null) => void
  canAcceptFolder?: (draggedFolderId: string, targetFolderId: string | null) => boolean
  onDropFiles?: DropFilesInFolder
  onFileAim?: (aim: FileDropAim | null) => void
  children: ReactNode
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const drop = useFolderDropTarget({
    folderId,
    onDropDocument: onDropDocument ?? (() => {}),
    onDropFolder,
    canAcceptFolder,
    disabled: !onDropDocument && !onDropFolder,
    onDropFiles,
    refusal: writable ? null : t('workspace.dropRefusedFolder', { name: label }),
    onFileAim,
    onSpringOpen,
  })
  return (
    <span
      className={cn('inline-flex rounded-control transition-colors', dropRing(drop))}
      data-drop-over={drop.isOver ? '' : undefined}
      data-testid={`crumb-drop-${folderId ?? 'root'}`}
      {...drop.dropProps}
    >
      {children}
    </span>
  )
}

export function useFolderLabels(folder: FolderItem): { openLabel: string; lockLabel: string | null } {
  const t = useTranslations(filesCopy)
  const ownAccessLabel = useFolderOwnAccessLabel()
  const lockLabel = folder.ownAccess ? ownAccessLabel(folder.ownAccess) : null
  return {
    lockLabel,
    openLabel: lockLabel
      ? t('folders.access.openRestricted', { name: folder.name, access: lockLabel })
      : t('folders.openFolder', { name: folder.name }),
  }
}

export function FolderNameEditor({
  folder,
  onRenameFolder,
  onDone,
  className,
}: {
  folder: FolderItem
  onRenameFolder: FolderNavProps['onRenameFolder']
  onDone: () => void
  className?: string
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const [value, setValue] = useState(folder.name)
  const [isRenaming, setIsRenaming] = useState(false)

  const commit = async (): Promise<void> => {
    const name = value.trim()
    if (isRenaming) return
    if (!name || name === folder.name) {
      onDone()
      return
    }
    setIsRenaming(true)
    const ok = await onRenameFolder(folder.id, name)
    setIsRenaming(false)
    if (ok) onDone()
  }

  return (
    <InputGroup className={className}>
      <InputGroupAddon align="start" className="left-2">
        <Folder aria-hidden />
      </InputGroupAddon>
      <Input
        autoFocus
        value={value}
        disabled={isRenaming}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void commit()
          if (event.key === 'Escape') onDone()
        }}
        aria-label={t('folders.renameLabel', { name: folder.name })}
        aria-busy={isRenaming}
        className="h-8 rounded-control pl-8 pr-8 text-sm"
        data-testid={`folder-rename-input-${folder.id}`}
      />
      {isRenaming && (
        <InputGroupAddon align="end">
          <Spinner size="sm" label={t('folders.renaming')} />
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}


export function FolderCard({
  folder,
  itemCount,
  knowledge,
  onOpen,
  onRenameFolder,
  onDeleteFolder,
  onDropDocument,
  onDropFolder,
  canAcceptFolder,
  actions,
  editing: editingProp,
  onEditingChange,
  readOnly = false,
  onDropFiles,
  onFileAim,
}: FolderTileProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const { openLabel, lockLabel } = useFolderLabels(folder)
  const [uncontrolledEditing, setUncontrolledEditing] = useState(false)
  const editing = editingProp ?? uncontrolledEditing
  const setEditing = onEditingChange ?? setUncontrolledEditing
  const drop = useFolderDropTarget({
    folderId: folder.id,
    onDropDocument: onDropDocument ?? (() => {}),
    onDropFolder,
    canAcceptFolder,
    disabled: !onDropDocument && !onDropFolder,
    onDropFiles,
    refusal: readOnly ? t('workspace.dropRefusedFolder', { name: folder.name }) : null,
    onFileAim,
    onSpringOpen: () => onOpen(folder.id),
  })

  return (
    <TileShell
      interactive
      data-folder-tile=""
      className={cn('group [contain-intrinsic-block-size:auto_64px]', dropRing(drop))}
      data-testid={`folder-card-${folder.id}`}
      data-drop-over={drop.isOver ? '' : undefined}
      {...(onDropFolder && !readOnly && !editing ? folderDragProps(folder.id, folder.parentId ?? null) : {})}
      {...drop.dropProps}
    >
      {/* Its ⋯ left of the chevron under the pointer; on a phone, which has no pointer and no chevron, always, at the
          sheet's end (a 44px target): the long press alone hid every folder's menu (review of 2026-11-10, finding 19). */}
      <div
        className="absolute right-8 top-1/2 z-[1] -translate-y-1/2 phone:right-1.5 pointer-coarse:opacity-100 md:opacity-0 md:group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100 transition-opacity duration-quick ease-out motion-reduce:transition-none"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {actions ?? (
          <FolderActionsMenu folder={folder} onStartRename={() => setEditing(true)} onDeleteFolder={onDeleteFolder} />
        )}
      </div>
      {/*
        THE NAME FIELD IS NEVER INSIDE THE OPEN BUTTON.

        It was, and every click into the field to place the caret bubbled to
        the button and opened the folder (#1055). An <input> inside a <button>
        is invalid HTML besides. While renaming, the same body renders in a
        plain wrapper and nothing on the tile opens the folder; the list row
        swaps its whole content for the editor for the same reason.
      */}
      <FolderCardFrame
        editing={editing}
        onOpen={() => onOpen(folder.id)}
        openLabel={openLabel}
      >
        {/* 56px at every width, radius 10, elevation 1, a chevron at its end (the ⋯ comes in left of it): a sheet that
            opens, not a press. One line for the name, cut at its end with the whole name as its title: a name of three
            lines made its row 138px beside rows of 82 (finding 6), and a folder's start is what tells it apart. */}
        <FileTileBody className="flex h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-3 pr-3 phone:gap-2.5 phone:pr-10">
          {/* One glyph, still: what says „this opens“ is the sheet's own fill under the pointer and the cursor (#1055's tile notes). */}
          <span className={FOLDER_WELL}>
            <Folder className="size-[18px] text-muted-foreground" strokeWidth={1.6} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            {editing ? (
              <FolderNameEditor folder={folder} onRenameFolder={onRenameFolder} onDone={() => setEditing(false)} />
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                {lockLabel && <FolderAccessMark label={lockLabel} testId={`folder-lock-${folder.id}`} />}
                <FolderName text={folder.name} className="text-name text-foreground" />
                {readOnly && <FolderReadOnlyBadge testId={`folder-read-only-${folder.id}`} />}
              </div>
            )}
            {/* What it holds, only what departs from „all read“ (the normal case is quiet), and what belongs in it in the
                folder owner's words, cut on this line with the whole of it as its title: a line of its own grew the card. */}
            {!editing && (
              <p className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-xs tabular-nums">
                <span className="shrink-0">{t('folders.items', { count: itemCount })}</span>
                <FolderReadState tally={knowledge} exceptionsOnly className="min-w-0" />
                {folder.description && (
                  <span className="min-w-0 truncate" title={folder.description} data-testid={`folder-description-${folder.id}`}>
                    · {folder.description}
                  </span>
                )}
              </p>
            )}
          </div>
          {!editing && <ChevronRight className="text-muted-foreground ml-7 size-4 shrink-0 phone:hidden" aria-hidden data-slot="folder-opens" />}
        </FileTileBody>
      </FolderCardFrame>
    </TileShell>
  )
}

export function FolderCardSkeleton(): JSX.Element {
  return (
    <TileShell interactive={false} data-folder-tile="" data-testid="folder-card-skeleton">
      <FileTileBody className={cn(FOLDER_SHEET, 'flex flex-1 items-center gap-3 py-2 pl-3 pr-2.5')}>
        <span className={FOLDER_WELL}>
          <Folder className="size-[18px] text-muted-foreground/30" strokeWidth={1.6} aria-hidden />
        </span>
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-12" />
        </div>
      </FileTileBody>
    </TileShell>
  )
}

export function FolderRowSkeleton(): JSX.Element {
  return (
    <Item className="w-full gap-2 px-2 py-1.5" data-testid="folder-row-skeleton">
      <span className="flex w-8 shrink-0 items-center">
        <Folder className="text-muted-foreground/40 size-4" aria-hidden />
      </span>
      <Skeleton className="h-3.5 w-40" />
      <Skeleton className="h-3.5 w-8 rounded-full" />
    </Item>
  )
}
