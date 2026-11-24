'use client'

import { Fragment, type Dispatch, type JSX, type SetStateAction } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Pagination } from '@/components/ui/pagination'
import { SortableHead } from '@/components/ui/sortable-head'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { KnowledgeFile } from '@/lib/knowledge/service'
import {
  DocClassChip,
  KnowledgeStateBadge,
} from '@/features/platform/components/knowledge-atoms'
import {
  CorpusGroupRow,
  PlacementLine,
  type CorpusPlacement,
} from '@/features/platform/components/corpus-placement'
import type { SortDir, SortKey } from '@/features/platform/lib/knowledge-file-filter'

const PAGE_SIZE = 10

interface KnowledgeFileTableProps {
  canManage: boolean
  filtered: KnowledgeFile[]
  offset: number
  selected: string[]
  setSelected: Dispatch<SetStateAction<string[]>>
  sortKey: SortKey
  sortDir: SortDir
  onToggleSort: (key: SortKey) => void
  onOpenDetail: (fileName: string) => void
  onOffsetChange: (offset: number) => void
  placement: CorpusPlacement
}

export function KnowledgeFileTable({
  canManage,
  filtered,
  offset,
  selected,
  setSelected,
  sortKey,
  sortDir,
  onToggleSort,
  onOpenDetail,
  onOffsetChange,
  placement,
}: KnowledgeFileTableProps): JSX.Element {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const safeOffset = offset >= filtered.length ? 0 : offset
  const page = filtered.slice(safeOffset, safeOffset + PAGE_SIZE)
  const allOnPageSelected = page.length > 0 && page.every((f) => selected.includes(f.fileName))
  const someOnPageSelected = page.some((f) => selected.includes(f.fileName))

  const sortableHead = (key: SortKey, label: string, className?: string) => (
    <SortableHead
      label={label}
      ariaLabel={t('knowledgeAdmin.sortBy', { column: label })}
      active={sortKey === key}
      direction={sortDir}
      onSort={() => onToggleSort(key)}
      className={className}
    />
  )

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {canManage ? (
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      allOnPageSelected
                        ? true
                        : someOnPageSelected
                          ? 'indeterminate'
                          : false
                    }
                    aria-label={t('knowledgeAdmin.selectAll')}
                    onCheckedChange={(checked) =>
                      setSelected((prev) => {
                        const names = page.map((f) => f.fileName)
                        return checked
                          ? [...new Set([...prev, ...names])]
                          : prev.filter((name) => !names.includes(name))
                      })
                    }
                  />
                </TableHead>
              ) : null}
              {sortableHead('document', t('knowledgeAdmin.colDocument'))}
              {sortableHead('class', t('knowledgeAdmin.colType'), 'max-sm:hidden')}
              {sortableHead('state', t('knowledgeAdmin.colState'), 'max-sm:hidden')}
              {sortableHead('chunks', t('knowledgeAdmin.colChunks'), 'text-right max-sm:hidden')}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.map((file, index) => {
              const isSelected = selected.includes(file.fileName)
              const group = placement.groupOf(file.fileName)
              const opensGroup = placement.loaded && (index === 0 || placement.groupOf(page[index - 1]!.fileName) !== group)
              return (
                <Fragment key={file.fileName}>
                {opensGroup ? <CorpusGroupRow group={group} colSpan={canManage ? 5 : 4} /> : null}
                <TableRow
                  data-state={isSelected ? 'selected' : undefined}
                  className="cursor-pointer"
                  onClick={() => onOpenDetail(file.fileName)}
                >
                  {canManage ? (
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        aria-label={t('knowledgeAdmin.selectRow', { name: file.fileName })}
                        onCheckedChange={(checked) =>
                          setSelected((prev) =>
                            checked
                              ? [...prev, file.fileName]
                              : prev.filter((name) => name !== file.fileName)
                          )
                        }
                      />
                    </TableCell>
                  ) : null}
                  {/* `max-w-0` + `w-full` is what makes `truncate` bite in an
                      auto-layout table: a plain `max-w` on a cell is ignored, so
                      the title used to stretch the column past the card edge and
                      push Dokumentart and Status out of sight. From `sm` the cap
                      is the 22rem it always was. */}
                  <TableCell className="w-full max-w-0 sm:w-auto sm:max-w-[22rem]">
                    <button
                      type="button"
                      className="pointer-coarse:min-h-11 focus-visible:ring-ring/60 block w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2"
                      aria-label={t('knowledgeAdmin.openDetail', { name: file.fileName })}
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenDetail(file.fileName)
                      }}
                    >
                      <span className="text-foreground block truncate text-sm font-medium">
                        {file.displayTitle ?? file.fileName}
                      </span>
                      {file.displayTitle && file.displayTitle !== file.fileName ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          {file.fileName}
                        </span>
                      ) : null}
                      {/* The Dokumentart and Status columns are hidden on a
                          phone; their chips ride under the title instead, so
                          the title has the card's width. */}
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:hidden">
                        <DocClassChip docClass={file.docClass} />
                        <KnowledgeStateBadge state={file.state} />
                      </span>
                    </button>
                    <PlacementLine placement={placement.of(file.fileName)} />
                  </TableCell>
                  <TableCell className="max-sm:hidden">
                    <DocClassChip docClass={file.docClass} />
                  </TableCell>
                  <TableCell className="max-sm:hidden">
                    <KnowledgeStateBadge state={file.state} hint="tooltip" />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right text-sm tabular-nums max-sm:hidden">
                    {file.chunkCount > 0 ? file.chunkCount.toLocaleString(locale) : '–'}
                  </TableCell>
                </TableRow>
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <Pagination
        offset={safeOffset}
        pageSize={PAGE_SIZE}
        total={filtered.length}
        onOffsetChange={onOffsetChange}
        rangeLabel={(from, to, total) =>
          t('knowledgeAdmin.range', {
            from: from.toLocaleString(locale),
            to: to.toLocaleString(locale),
            total: total.toLocaleString(locale),
          })
        }
        previousLabel={t('knowledgeAdmin.previous')}
        nextLabel={t('knowledgeAdmin.next')}
      />
    </>
  )
}
