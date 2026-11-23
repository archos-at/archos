'use client'

import { SourceDeletedNote } from '@/components/projects/source-deleted-note'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Mail } from 'lucide-react'
import type { FileItem } from './project-file-workspace'
import { DocumentStatusBadge, isCitableStatus } from './document-status'
import { Checkbox } from '@/components/ui/checkbox'
import { DocumentVersionStateBadge } from './document-version-badge'
import { RevisionCount, OlderRevisionBadge, isOlderRevisionEntry } from './revision-badge'
import { documentBadgeState } from '../lib/document-lifecycle'
import { approvalSubjectOf, listColumns, type FileListColumns } from './file-list-columns'
import { FILE_LIST_CELL as CELL, FILE_LIST_DATE_CELL, FILE_LIST_META_LINE, FILE_LIST_SIZE_CELL, FileListLayoutContext } from './file-list-layout'

export { FILE_LIST_CELL, FILE_LIST_DATE_CELL, FILE_LIST_SIZE_CELL, FileListLayoutContext } from './file-list-layout'
export { FileListSkeleton } from './file-list-skeleton'
import { fileExtensionLabel } from '../document-kind'
import { MarkedSnippet } from './semantic-match'
import { DEFAULT_FILE_SORT, RELEVANCE_SORT, nextSort, sortFiles, type FileSort, type FileSortKey } from '../lib/file-sort'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { CLAUSE_JOIN, formatAbsoluteTime, formatBytes, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { MailThreadFileFacts, listedFileName, useMailThreadFileFacts } from './mail-thread/mail-thread-file'
import { documentDragProps } from '../hooks/use-document-drag'
import { FilingSuggestionSlot, useFilingHighlighted } from './filing-suggestion'
import { HIGHLIGHT_OUTLINE_INSET } from '@/components/ui/highlight'
import { ROW_REVEAL, TABLE_ROW_HAIRLINE } from '@/components/ui/row-hairline'
import { FileName } from './file-name'
import { OpenMarksChip } from './open-marks-chip'
import { BaseKnowledgeChip } from './base-knowledge-chip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export type FileListRow = FileItem & { snippet?: string; page?: number | null; rank?: number }

interface FileListViewProps {
  files: FileListRow[]
  selectedFileId: string | null
  onSelectFile: (id: string | null) => void
  renderActions?: (file: FileItem) => ReactNode
  wrapRow?: (file: FileItem, row: ReactNode) => ReactNode
  semantic?: boolean
  query?: string | null
  sort?: FileSort
  onSortChange?: (next: FileSort) => void
  draggable?: boolean
  selection?: { active: boolean; selectedIds: ReadonlySet<string>; onToggle: (id: string) => void }
  folderRows?: ReactNode
}

export function FileListView({
  files,
  selectedFileId,
  onSelectFile,
  renderActions,
  wrapRow,
  semantic = false,
  query = null,
  sort: controlledSort,
  onSortChange,
  draggable = false,
  selection,
  folderRows,
}: FileListViewProps) {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const [uncontrolledSort, setUncontrolledSort] = useState<FileSort>(
    semantic ? RELEVANCE_SORT : DEFAULT_FILE_SORT
  )
  const sort = semantic || !controlledSort ? uncontrolledSort : controlledSort
  const showRank = semantic && sort.key !== 'relevance'
  const setSort = semantic || !onSortChange ? setUncontrolledSort : onSortChange
  const bodyRef = useRef<HTMLTableSectionElement>(null)

  const rows = useMemo(() => sortFiles(files, sort, locale), [files, sort, locale])
  const fileColumns = useMemo(() => listColumns(files), [files])
  const columns = useMemo(() => (folderRows ? { ...fileColumns, size: true } : fileColumns), [fileColumns, folderRows])

  const picking = selection?.active === true
  const onToggle = selection?.onToggle
  const activate = useCallback(
    (id: string | null) => {
      if (picking && id !== null) onToggle?.(id)
      else onSelectFile(id)
    },
    [picking, onToggle, onSelectFile]
  )

  const [focusedIndex, setFocusedIndex] = useState(0)
  const tabStop = Math.min(focusedIndex, Math.max(0, rows.length - 1))

  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableRowElement>, index: number) => {
      if (event.target !== event.currentTarget) return
      const current = rowsRef.current
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
      const absolute = event.key === 'Home' ? 0 : event.key === 'End' ? current.length - 1 : null
      if (step !== 0 || absolute !== null) {
        event.preventDefault()
        const next = absolute ?? Math.min(current.length - 1, Math.max(0, index + step))
        const target = bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-file-row]')[next]
        target?.focus()
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const file = current[index]
        if (file) activate(file.id)
      }
    },
    [activate]
  )

  return (
    <div className="@container/filelist px-2 pb-4 pt-1 md:-mx-2 md:px-0">
      {/* `table-fixed` IS THE TRUNCATION. Every filename cell below already
          carries `truncate`, and under the browser's default `table-layout: auto`
          that class did nothing at all: auto layout sizes a column to its
          content's minimum, a filename does not wrap, so the minimum IS the whole
          name. Measured on a 390px phone the Name column came out 437px inside a
          308px wrapper — the `overflow-x-auto` on the Table primitive caught it,
          so nothing looked broken, and the reader simply had to drag the list
          sideways to find out what any of their documents were called.
          Dropping columns as the list narrows (below) never touched this: it
          removes the columns that were not the problem.

          Fixed layout makes the declared widths mean what they say and hands the
          rest to the one `w-auto` column, so the name gets whatever the viewport
          has left and the ellipsis finally engages. Desktop is unchanged in
          practice — there the name column was already taking the remainder. */}
      <FileListLayoutContext.Provider value={{ picking, showRank, columns, actions: renderActions !== undefined }}>
      <Table
        scrollX={false}
        role="grid"
        className="table-fixed border-separate border-spacing-0 text-left"
        data-testid="file-list-view"
      >
        {/* Below the reference columns the head is a lone „Name“ over the one column, a head that says nothing: the
            filter menu sorts there. */}
        {/* Pinned while a long level scrolls under it (240 drawings, finding 22), on the page's paper. */}
        <TableHeader className="bg-background sticky top-0 z-10 hidden @xl/filelist:table-header-group">
          <TableRow className="hover:bg-transparent">
            {picking && <TableHead scope="col" className="h-auto w-11 p-0" aria-label={t('selection.column')} />}
            <SortHeader
              label={t('list.columns.name')}
              column="name"
              sort={sort}
              onSort={setSort}
              className="w-auto [&>button]:pl-[50px]" /* over the names, past the 32px format column */
            />
            {/* Only while another column orders the rows: sorted by relevance the order IS the rank, and a column of
                „1, 2, 3“, or an empty one under its header, only repeated it. Its header is the way back. */}
            {showRank && (
              <SortHeader
                label={t('list.columns.relevance')}
                column="relevance"
                sort={sort}
                onSort={setSort}
                align="right"
                className="hidden w-[92px] @3xl/filelist:table-cell"
              />
            )}
            {/* Freigabe and Seiten step in only when a row has something to say (`listColumns`). The reference columns
                step in where the name keeps ~220px: Freigabe and Größe at 48rem, Hinzugefügt at 56rem, Seiten at 64rem.
                What is in progress or open on a document („Wird gelesen“, „4 offen“) stands after its name, in one
                place, as the tile carries both on itself: a Status column held one and not the other. Sorting by
                status stays in the filter menu. */}
            {columns.approval && (
              <TableHead scope="col" className="hidden h-auto w-[120px] px-2 py-1.5 @3xl/filelist:table-cell">
                {t('list.columns.approval')}
              </TableHead>
            )}
            {columns.pages && (
              <TableHead scope="col" className="hidden h-auto w-[76px] px-2 py-1.5 text-right @5xl/filelist:table-cell">
                {t('list.columns.pages')}
              </TableHead>
            )}
            {columns.size && (
              <SortHeader
                label={t('list.columns.size')}
                column="size"
                sort={sort}
                onSort={setSort}
                align="right"
                className="hidden w-[104px] @xl/filelist:table-cell"
              />
            )}
            {/* Dates left-align, as their head reads; numbers (Größe, Seiten, Relevanz) right-align to theirs. */}
            <SortHeader
              label={t('list.columns.added')}
              column="added"
              sort={sort}
              onSort={setSort}
              className="hidden w-[120px] @2xl/filelist:table-cell"
            />
            {renderActions && <TableHead scope="col" className="h-auto w-10 p-0" />}
          </TableRow>
        </TableHeader>
        <TableBody ref={bodyRef}>
          {folderRows}
          {rows.map((file, index) => (
            <FileListRowItem
              key={file.id}
              file={file}
              index={index}
              isSelected={selectedFileId === file.id}
              isTabStop={index === tabStop}
              semantic={semantic}
              query={query}
              showRank={showRank}
              columns={columns}
              draggable={draggable && !picking}
              picking={picking}
              checked={picking && selection?.selectedIds.has(file.id) === true}
              onSelectFile={activate}
              onToggle={onToggle}
              onFocusIndex={setFocusedIndex}
              onRowKeyDown={handleKeyDown}
              renderActions={renderActions}
              wrapRow={wrapRow}
            />
          ))}
        </TableBody>
      </Table>
      </FileListLayoutContext.Provider>
    </div>
  )
}

interface FileListRowItemProps {
  file: FileListRow
  index: number
  isSelected: boolean
  isTabStop: boolean
  semantic: boolean
  query: string | null
  showRank: boolean
  columns: FileListColumns
  draggable: boolean
  picking: boolean
  checked: boolean
  onToggle?: (id: string) => void
  onSelectFile: (id: string | null) => void
  onFocusIndex: (index: number) => void
  onRowKeyDown: (event: KeyboardEvent<HTMLTableRowElement>, index: number) => void
  renderActions?: (file: FileItem) => ReactNode
  wrapRow?: (file: FileItem, row: ReactNode) => ReactNode
}

const FileListRowItem = memo(function FileListRowItem({
  file,
  index,
  isSelected,
  isTabStop,
  semantic,
  query,
  showRank,
  columns,
  draggable,
  picking,
  checked,
  onToggle,
  onSelectFile,
  onFocusIndex,
  onRowKeyDown,
  renderActions,
  wrapRow,
}: FileListRowItemProps): ReactNode {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const approvalSubject = approvalSubjectOf(file)
  const threadFacts = useMailThreadFileFacts(file)
  const approvalState = documentBadgeState(approvalSubject)
  const lit = useFilingHighlighted(file.id)
  const row = (
    <TableRow
      data-file-row
      data-testid="file-list-row"
      {...(draggable ? documentDragProps(file.id, file.folderId ?? null) : {})}
      data-state={isSelected || checked ? 'selected' : undefined}
      data-filled={isSelected || checked || undefined}
      tabIndex={isTabStop ? 0 : -1}
      aria-selected={picking ? checked : isSelected}
      onClick={() => onSelectFile(file.id)}
      onFocus={() => onFocusIndex(index)}
      onKeyDown={(event) => onRowKeyDown(event, index)}
      className={cn(
        'group/row cursor-pointer border-b-0 focus-visible:outline-none [--row-end:8px] [--row-lead:50px]', TABLE_ROW_HAIRLINE,
        lit && HIGHLIGHT_OUTLINE_INSET,
        'transition-colors duration-snap ease-out motion-reduce:transition-none',
        isSelected || checked ? 'bg-selected hover:bg-selected data-[state=selected]:bg-selected' : 'hover:bg-hover',
        'focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50'
      )}
    >
      {picking && (
        <TableCell className="w-11 p-0 text-center" data-row-skip onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={checked}
            onCheckedChange={() => onToggle?.(file.id)}
            aria-label={listedFileName(file)}
            data-testid="file-list-check"
          />
        </TableCell>
      )}
      <TableCell className={CELL} data-row-text>
        <div className="flex min-h-8 min-w-0 items-start gap-2.5 py-1.5" /* the format on the name's first line, wrapped or not */>
          {/* The format in words, as the tile's meta writes it (8.5px in a disc was illegible); 32px, a folder's glyph column. */}
          <span className="text-muted-foreground w-8 shrink-0 text-[11px] font-medium uppercase leading-5" aria-hidden>
            {file.mailThread ? <Mail className="mt-0.5 size-4" strokeWidth={1.75} data-testid="file-list-mail-thread" /> : fileExtensionLabel(file.filename) || '—'}
          </span>
          <span className="min-w-0 flex-1">
            {/* „· 3 Fassungen" after the name, on the same line: the
                history belongs to the document, not to the „Freigabe"
                column, and here it never makes a row taller. */}
            {/* Wraps rather than cut the name: a chip that does not fit beside it takes the next line (a phone's
                „E…_Index-C.pdf“ beside „4 offen · 2 für Sie“ was the name cut to its last letters). */}
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13px] font-medium leading-5 text-foreground" /* 13px, a 20px line a chip fits */>
              <FileName text={listedFileName(file)} className="flex-1" /* the line's width, then the chips: as wide as its own text it measured itself to nothing */ />
              {/* A Verlauf's mails beside its name at desk width; a narrow list says them on its second line. */}
              {file.mailThread ? <MailThreadFileFacts file={file} className="hidden shrink-0 font-normal @xl/filelist:inline" /> : <RevisionCount file={file} />}
              <BaseKnowledgeChip file={file} className="self-center" />
              {file.status && !isCitableStatus(file.status) && (
                <DocumentStatusBadge status={file.status} queueAhead={file.queueAhead} className="h-5 shrink-0 self-center px-2 py-0" /* 20px, the open-marks chip's: a 22px badge made its row 42 */ />
              )}
              {/* What is still open on its pages; a press opens the review, not the row. */}
              <OpenMarksChip file={file} name={listedFileName(file)} className="self-center" />
              {/* Where the agent would file it: the same chip as on the card,
                  right after the name, so the row keeps its one height. */}
              <FilingSuggestionSlot documentId={file.id} className="max-w-[45%] shrink-0 self-center" />
              {/* The summary on the name's line, in what is left of it (Gmail's snippet): one 40px row, not two lines.
                  A narrow list (a phone) has nothing left of it, so there it is the second line. */}
              {!semantic && file.summary && <span className="text-meta text-muted-foreground hidden min-w-0 truncate font-normal @xl/filelist:block @xl/filelist:flex-1 @xl/filelist:basis-0" title={file.summary}>{file.summary}</span>}
            </span>
            {/* A narrow list's second line: what the columns say at desk width (a phone's 56px row, finding 14). */}
            <span className={FILE_LIST_META_LINE} data-testid="file-list-meta">
              {[threadFacts ?? (typeof file.fileSize === 'number' ? formatBytes(file.fileSize, locale) : null), formatRelativeTime(file.createdAt, locale)].filter(Boolean).join(CLAUSE_JOIN)}
            </span>
            {file.sourceDeletedAt && <SourceDeletedNote at={file.sourceDeletedAt} />}
            {/* In a ranked result the second line is WHY this row is here: the snippet answers the query, and a
                search result that hides it asks the reader to take the ranking on trust. */}
            {semantic && (file.snippet ?? '') !== '' && (
                <span
                  className="block truncate text-xs leading-tight text-muted-foreground"
                  title={file.snippet}
                  data-testid="file-list-snippet"
                >
                  {file.page !== null && file.page !== undefined && (
                    <span className="mr-1 font-medium tabular-nums">{t('browser.semantic.page', { page: String(file.page) })}</span>
                  )}
                  <MarkedSnippet text={file.snippet ?? ''} query={query} />
                </span>
            )}
          </span>
        </div>
      </TableCell>
      {showRank && (
        <TableCell
          className={cn(
            'hidden whitespace-nowrap text-right text-xs tabular-nums @3xl/filelist:table-cell',
            CELL,
          )}
        >
          {file.rank !== undefined && (
            <span
              className="font-medium text-foreground"
              title={t('browser.semantic.rank', { rank: String(file.rank) })}
              data-testid="file-list-relevance"
            >
              {file.rank}
            </span>
          )}
        </TableCell>
      )}
      {columns.approval && (
        <TableCell className={cn('hidden @3xl/filelist:table-cell', CELL)}>
          {/* The editorial state in the card badge's words, silent by the same rule; an older Fassung is one badge. */}
          {isOlderRevisionEntry(file) ? (
            <OlderRevisionBadge file={file} className="max-w-full truncate" />
          ) : approvalState && !file.mailThread ? (
            <DocumentVersionStateBadge
              versionState={approvalSubject.versionState}
              versionCount={approvalSubject.versionCount}
              lifecycle={approvalSubject.lifecycle}
              authoredBy={approvalSubject.authoredBy}
              className="max-w-full truncate"
            />
          ) : (
            <span className="text-xs text-muted-foreground" data-testid="file-list-approval-empty">
              —
            </span>
          )}
        </TableCell>
      )}
      {columns.pages && (
        <TableCell
          className={cn('hidden whitespace-nowrap text-right text-xs text-muted-foreground tabular-nums @5xl/filelist:table-cell', CELL)}
        >
          {file.pageCount ?? '—'}
        </TableCell>
      )}
      {columns.size && (
        <TableCell className={cn(FILE_LIST_SIZE_CELL, CELL)}>
          {typeof file.fileSize === 'number' ? formatBytes(file.fileSize, locale) : '—'}
        </TableCell>
      )}
      <TableCell className={cn(FILE_LIST_DATE_CELL, CELL)}>
        <time
          dateTime={file.createdAt}
          title={formatAbsoluteTime(file.createdAt, locale)}
          suppressHydrationWarning
        >
          {formatRelativeTime(file.createdAt, locale)}
        </time>
      </TableCell>
      {renderActions && (
        <TableCell
          className="w-10 px-1 py-1 text-right pointer-coarse:w-11 pointer-coarse:px-0" /* a finger's ⋯ is 44px: in 32px it ran 8px past the table and the list scrolled sideways */
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {/* Every row offers the same menu: at rest it waits, under the pointer, on focus and on the selected row it
              shows, and a finger always sees it (`ROW_REVEAL`, principle 6), as a folder row's does. */}
          {picking ? null : <span className={cn('inline-flex', ROW_REVEAL)}>{renderActions(file)}</span>}
        </TableCell>
      )}
    </TableRow>
  )
  return wrapRow ? wrapRow(file, row) : row
})

function SortHeader({
  label,
  column,
  sort,
  onSort,
  align = 'left',
  className,
}: {
  label: string
  column: FileSortKey
  sort: FileSort
  onSort: (sort: FileSort) => void
  align?: 'left' | 'right'
  className?: string
}) {
  const isActive = sort.key === column
  const Arrow = sort.direction === 'asc' ? ArrowUp : ArrowDown

  return (
    <TableHead
      scope="col"
      aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('h-auto p-0', className)}
    >
      <button data-attr="files-sort"
        type="button"
        onClick={() => onSort(nextSort(sort, column))}
        className={cn(
          'flex w-full items-center gap-1 px-2 py-1.5 pointer-coarse:min-h-11 text-xs font-medium transition-colors duration-snap ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 motion-reduce:transition-none',
          align === 'right' && 'flex-row-reverse',
          isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {label}
        {/* The arrow is reserved space on every header, so activating a sort
            does not shift the row it lives in. */}
        <Arrow
          className={cn(
            'size-3 shrink-0 transition-opacity duration-snap ease-out motion-reduce:transition-none',
            isActive ? 'opacity-100' : 'opacity-0'
          )}
          aria-hidden
        />
      </button>
    </TableHead>
  )
}
