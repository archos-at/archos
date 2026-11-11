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

/**
 * Finder-style folder navigation: the drill-down that replaced the tree pane.
 *
 * The tree drew every level at once in a side band and, outside the tree view,
 * nested folders were unreachable at all (the chip row listed top-level
 * folders only). This module makes drilling the ONE model: at each level the
 * folders render as cards (or rows) beside the files, clicking one enters it,
 * and the breadcrumb up top names the path and walks back out. Same flat
 * `FolderItem[]` data, same server API — only the presentation changed.
 */

export interface FolderNavProps {
  folders: FolderItem[]
  currentFolderId: string | null
  onNavigate: (id: string | null) => void
  onCreateFolder: (name: string, parentId?: string) => Promise<boolean>
  onRenameFolder: (folderId: string, name: string) => Promise<boolean>
  onDeleteFolder: (folderId: string) => Promise<boolean>
}

/**
 * The path row: `All Files › Planung › Statik`, every ancestor a link, plus
 * the "New folder" control for the level the reader is standing in.
 */
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
  /** What the top of the path is called; „Alle Dateien“ unless the place names its own (the office standards). */
  rootLabel?: string
  /** A query filters the files: the path is not where the reader is then, but the level's tools stay in the tool row. */
  searching?: boolean
  /** What the open folder holds, beside its name in the header („240 Elemente“). */
  itemCount?: number
  /** The level shows its empty state: the tool row's Hochladen steps back to its own (`useSectionPrimaryYields`). */
  emptyLevel?: boolean
  /** Absent for a read-only viewer: the path is still walkable, nothing can be created. */
  onCreateFolder?: FolderNavProps['onCreateFolder']
  children?: ReactNode
  /** At the root the caller offers the tools itself (a phone's ⋯), so the row has nothing to hold. */
  rootToolsElsewhere?: boolean
  /**
   * The reader may only read the level they stand in (ADR-0088): „Nur lesen"
   * takes the place of „Neuer Ordner".
   */
  readOnly?: boolean
  /** Dropping a document on „Alle Dateien" moves it back to the project root. */
  onDropDocument?: (documentId: string, folderId: string | null) => void
  /**
   * Dropping a FOLDER there moves it out to the project root.
   *
   * This is the only way OUT. Every other target nests one folder inside
   * another, so without it a folder could be dragged deeper and never back —
   * the same half-a-gesture the document drag shipped with before the root
   * became a target for it.
   */
  onDropFolder?: (draggedFolderId: string, parentId: string | null) => void
  canAcceptFolder?: (draggedFolderId: string, targetFolderId: string | null) => boolean
  /** Desktop files dropped on a way up land at that level. */
  onDropFiles?: DropFilesInFolder
  onFileAim?: (aim: FileDropAim | null) => void
  /** Whether the reader may write at a level (ADR-0088); a level they may not is no target. Defaults to yes. */
  mayWriteAt?: (folderId: string | null) => boolean
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const allLabel = rootLabel ?? t('folders.allFiles')
  const path = useMemo(() => folderPath(folders, currentFolderId), [folders, currentFolderId])
  /** Every way up is a drop target, offered while there is somewhere to come back FROM. */
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

  /**
   * Where "up one level" goes: the parent folder, or the root.
   *
   * Null at the root, where there is nothing to go up to.
   */
  const parent = currentFolderId === null ? undefined : path[path.length - 2]
  const parentLabel = parent ? parent.name : allLabel
  const tabSlot = useSectionTabActionsSlot()
  const placeSlot = useSectionPlaceSlot()
  // Where the tool row has no room for „Ordner anlegen“, it is an entry of Hochladen's menu that opens this dialog.
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

  // At the root the crumb is the project, so the row held only its tools: they go to the section's tool row on a
  // desk, and to the ⋯ on a phone, and the brief rises by the row.
  if ((currentFolderId === null || searching) && tabSlot) return inRow
  if (searching || (currentFolderId === null && rootToolsElsewhere)) return null
  // Inside a folder within the section's frame, the header names it (title, crumb, the phone's ←) and the level's
  // tools join the tool row as at the root (a phone's go to its ⋯): the row would say the path a second time.
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
      // The row PINS to the top of the list, on the page's base surface so no
      // card shows through. It is the list's first child and scrolled away with
      // the cards, taking „Ordner anlegen" and the way up with it; on a phone it
      // was left half-hidden under the controls. Pinned, it is whole, never cut.
      // No hairline under it; at the root it holds only its controls (the crumb is the tab above), so it sits tighter.
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
  /** Documents + subfolders directly inside, for the count line. */
  itemCount: number
  /** Most recent child's timestamp — the "last change" for this folder, like file cards show file time. */
  lastModified?: string | null
  /**
   * Where the folder's whole subtree stands with Piloti (`subtreeTallies`): a
   * dot beside the name on a tile, the dot and its words on a list-view row.
   */
  knowledge?: KnowledgeTally
  onOpen: (id: string) => void
  onRenameFolder: FolderNavProps['onRenameFolder']
  onDeleteFolder: FolderNavProps['onDeleteFolder']
  /** Replaces the built-in ⋯ when the caller owns the menu (right-click + overflow). */
  actions?: ReactNode
  /** Controlled rename; omit to keep the in-place editor private to the tile. */
  editing?: boolean
  onEditingChange?: (editing: boolean) => void
  /**
   * Move a document into this folder, when the surface supports dragging one
   * here. Absent on surfaces that do not (the Archiv has no folders at all).
   */
  onDropDocument?: (documentId: string, folderId: string | null) => void
  /**
   * Re-parent another folder into this one. Absent turns the folder drag OFF
   * for this tile in both directions: a tile that lifts under the finger where
   * nothing can receive it promises a move the surface cannot make.
   */
  onDropFolder?: (draggedFolderId: string, parentId: string | null) => void
  /** Whether this tile may receive that folder — see `useFolderDropTarget`. */
  canAcceptFolder?: (draggedFolderId: string, targetFolderId: string | null) => boolean
  /**
   * The reader may only read here (ADR-0088): „Nur lesen" beside the name, and
   * nothing can be dropped on the tile. The server refuses a write anyway.
   */
  readOnly?: boolean
  /** Files from the desktop released on this folder go into it. Absent leaves them to the surface. */
  onDropFiles?: DropFilesInFolder
  /** Told where desktop files would land while they hover the tile. */
  onFileAim?: (aim: FileDropAim | null) => void
}

/** Files dropped from the desktop into a folder; `null` is the shelf's top level. */
export type DropFilesInFolder = (
  files: File[],
  info: { truncated: boolean; unreadable: number },
  folderId: string | null
) => void

/** The ring a drop target wears: where it will land, or that it will not take it. */
export function dropRing(drop: { isOver: boolean; refuses: boolean }, inset = false): string | false {
  if (drop.refuses) return cn('ring-destructive ring-2', inset && 'ring-inset')
  return drop.isOver && cn('bg-accent ring-ring ring-2', inset && 'ring-inset')
}

/**
 * One way up, as a drop target: a segment of the path, „Alle Dateien", or the
 * back control. Dropping on it moves the document or folder to that level,
 * and desktop files land there.
 *
 * Only „Alle Dateien" took a drop, so a document three levels down could go
 * to the top or deeper, never one level up, and the back control, the biggest
 * way up on screen, took nothing.
 */
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
  /** Held over, the drag walks up to that level. */
  onSpringOpen?: () => void
  /** The reader may write at that level (ADR-0088): otherwise nothing lands there. */
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

/**
 * The open button's accessible name, and the lock's tooltip on a folder with
 * its own access list (ADR-0088, `folder.ownAccess`): a restricted folder says
 * so in both. Null `lockLabel` draws no lock.
 */
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

/** Shared inline rename field — same in-place contract the tree pane had. */
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
    // On failure the field stays open with the typed name intact.
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

/**
 * Put on the grid that holds folder tiles: below `phone` each one spans the
 * row, so folders read as a list ahead of the files. The CELL is whatever the
 * context menu wraps the tile in, which this file does not own, so the grid
 * finds it by the mark the tile carries.
 */

/** The folder glyph's slot: as tall as the name and its count, as wide as the glyph, so the glyph stands on the column's edge. */


/**
 * A folder as a grid tile — visually DISTINCT from {@link FileCard}.
 *
 * A file card shows the document itself: a page preview, a thumbnail, or the
 * kind sketch we draw when there is neither. A folder card shows a folder
 * filling that same well, and the difference between "a page" and "a container"
 * is the whole distinction. It used to be carried by a warm amber wash as well;
 * that wash was invisible at its own opacity in the grid and read as a warning
 * strip in the detail view, and gold is a provenance signal in this product
 * (see `file-tile.tsx` for the argument). What is left is the thing that was
 * doing the work.
 *
 * Hover fills the tile (the shell's state fill), as a file tile and a list row
 * do; the press is the one motion. The glyph used to open on hover as well; a
 * mouse-only flourish is not one this product keeps.
 */
export function FolderCard({
  folder,
  itemCount,
  // The tile says how much it holds; when it last changed is the list view's column.
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
      // A folder is a 56px sheet (glyph, name, what it holds, a chevron) inside the tile's 6px hover inset, its edge
      // on the thumbnails' edge: apart from a document by its shape, a strip, not a page. On a phone it is a 48px
      // sheet in the grid's two columns, glyph, name and count, its ⋯ a long press away (the object menu): three
      // full-width sheets put the first thumbnail at y=475.
      data-folder-tile=""
      // A drag has to say where it will land, or it is a guess with a cursor.
      className={cn('group [contain-intrinsic-block-size:auto_64px]', dropRing(drop))}
      data-testid={`folder-card-${folder.id}`}
      data-drop-over={drop.isOver ? '' : undefined}
      // Source as well as target: a folder is moved by dragging it onto
      // another, which is the same gesture that moves a document.
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
          {/* One glyph, still: what says „this opens“ is the fill under the pointer and the cursor (#1055's tile notes). */}
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

/**
 * The folder placeholders, kept in this file on purpose.
 *
 * A skeleton is a promise about the layout that is one frame away, and the only
 * way it keeps that promise is by being edited in the same breath as the thing
 * it stands for. The Files skeleton drifted precisely because it lived
 * somewhere else: it drew a full-width search bar the page had moved into its
 * header a release earlier, and no folder tiles at all, so the first paint
 * showed a shape that was never going to arrive.
 *
 * Each one reuses the REAL wrapper — the same shell, the same row chrome, the
 * same padding — so a change to the tile moves its placeholder with it and only
 * the ink inside is grey.
 */

/** A {@link FolderCard} before its name arrives. */
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

/** A {@link FolderRow} before its name arrives. */
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
