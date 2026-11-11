'use client'

import type { ComponentPropsWithRef, JSX } from 'react'
import { useContext, useState } from 'react'
import { Folder } from 'lucide-react'
import { motion } from '@/components/motion'
import { TABLE_ROW_HAIRLINE } from '@/components/ui/row-hairline'
import { TableCell, TableRow } from '@/components/ui/table'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import { folderDragProps, useFolderDropTarget } from '../hooks/use-document-drag'
import { FolderName } from './file-name'
import { FILE_LIST_CELL, FILE_LIST_DATE_CELL, FILE_LIST_META_LINE, FILE_LIST_SIZE_CELL, FileListLayoutContext } from './file-list-layout'
import { CLAUSE_JOIN, formatRelativeTime } from '@/lib/format'
import { FolderAccessMark, FolderReadOnlyBadge } from './folder-access-mark'
import { FolderActionsMenu, FolderNameEditor, dropRing, useFolderLabels, type FolderTileProps } from './folder-navigation'
import { FolderReadState } from './folder-read-state'

/**
 * A folder as a row of the detail view's table — the list view's counterpart
 * to `FolderCard`. It is a row of the file table itself (`FileListView`'s
 * `folderRows`), under the one column head: its name in the name column past
 * the 32px glyph column, what it holds under Größe, when it changed under
 * Hinzugefügt, its ⋯ in the actions column, a 40px row like a file's. Round 3
 * drew the folders as a block above the table, so the head stood mid-table,
 * the counts ended 10px left of Größe and the rows were 36px against the
 * files' 40. A folder does not sort with the files: it stays at the top.
 */
export function FolderRow({
  folder,
  itemCount,
  lastModified,
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
  ...rowProps
}: FolderTileProps & Omit<ComponentPropsWithRef<typeof TableRow>, 'children'>): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const layout = useContext(FileListLayoutContext)
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
  const changedAt = lastModified ?? folder.createdAt ?? null
  const count = t('folders.items', { count: itemCount })

  // The cells the head draws, empty where a folder has nothing to say (Freigabe, Seiten, Relevanz).
  const empty = (className: string) => <TableCell className={cn('hidden', className, FILE_LIST_CELL)} />

  return (
    <TableRow
      {...rowProps}
      data-row
      data-testid={`folder-row-${folder.id}`}
      data-drop-over={drop.isOver ? '' : undefined}
      // The table's inset hairline (`TABLE_ROW_HAIRLINE`), from the name; the hover the desk, as a file row's.
      className={cn('group group/row border-b-0 [--row-end:8px] [--row-lead:50px] hover:bg-hover', TABLE_ROW_HAIRLINE, dropRing(drop, true), rowProps.className)}
      {...(onDropFolder && !readOnly && !editing ? folderDragProps(folder.id, folder.parentId ?? null) : {})}
      {...drop.dropProps}
    >
      {layout.picking && <TableCell className="w-11 p-0" data-row-skip />}
      <TableCell className={FILE_LIST_CELL} data-row-text>
        {editing ? (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex min-h-8 items-center">
            <FolderNameEditor folder={folder} onRenameFolder={onRenameFolder} onDone={() => setEditing(false)} className="max-w-96 flex-1" />
          </motion.div>
        ) : (
          <button
            data-attr="files-open"
            type="button"
            onClick={() => onOpen(folder.id)}
            aria-label={openLabel}
            className="focus-visible:ring-ring flex min-h-8 w-full min-w-0 items-center gap-2.5 rounded-control text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 pointer-coarse:min-h-12"
          >
            {/* A bare glyph, as on the folder tile, in the 32px column where a file row writes its format. */}
            <span className="flex w-8 shrink-0 items-center">
              <Folder className="text-muted-foreground size-4" aria-hidden />
            </span>
            {/* Below the size column, what it holds and when it changed are its second line, as a file row's (finding 15). */}
            <span className="min-w-0 shrink">
              <FolderName text={folder.name} className="text-foreground font-medium" />
              <span className={FILE_LIST_META_LINE}>{[count, changedAt ? formatRelativeTime(changedAt, locale) : null].filter(Boolean).join(CLAUSE_JOIN)}</span>
            </span>
            {folder.description && (
              <span className="text-muted-foreground hidden min-w-0 truncate text-xs sm:inline" title={folder.description} data-testid={`folder-description-${folder.id}`}>
                {folder.description}
              </span>
            )}
            {lockLabel && <FolderAccessMark label={lockLabel} testId={`folder-lock-${folder.id}`} />}
            {readOnly && <FolderReadOnlyBadge testId={`folder-read-only-${folder.id}`} />}
            <span className="flex-1" />
            {/* Only what departs from „all read“, as on the tile: the normal case is quiet. */}
            <FolderReadState tally={knowledge} exceptionsOnly />
          </button>
        )}
      </TableCell>
      {layout.showRank && empty('@3xl/filelist:table-cell')}
      {layout.columns.approval && empty('@3xl/filelist:table-cell')}
      {layout.columns.pages && empty('@5xl/filelist:table-cell')}
      {layout.columns.size && <TableCell className={cn(FILE_LIST_SIZE_CELL, FILE_LIST_CELL)}>{count}</TableCell>}
      <TableCell className={cn(FILE_LIST_DATE_CELL, FILE_LIST_CELL)}>
        {/* „—“ where nothing in it has a date: an empty cell read as a value missing (finding 21). */}
        {changedAt ? <TimeAgo date={changedAt} locale={locale} /> : '—'}
      </TableCell>
      {layout.actions && (
        <TableCell className="w-10 px-1 py-1 text-right pointer-coarse:w-11 pointer-coarse:px-0" /* a finger's ⋯ is 44px: in 32px it ran 8px past the table and the list scrolled sideways */ onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
          {layout.picking ? null : (actions ?? <FolderActionsMenu folder={folder} onStartRename={() => setEditing(true)} onDeleteFolder={onDeleteFolder} />)}
        </TableCell>
      )}
    </TableRow>
  )
}
