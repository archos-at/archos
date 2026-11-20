'use client'

import type { JSX } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import type { BaseKnowledgeEntry } from '@/lib/base-knowledge/wire'
import { usePhoneLayout } from '@/features/documents'
import { EntryName, StatusChip, TextUseChip } from './entry-atoms'

interface EntryTableProps {
  entries: readonly BaseKnowledgeEntry[]
  canManage: boolean
  selected: ReadonlySet<string>
  onToggle: (entryId: string, on: boolean) => void
  onToggleAll: (on: boolean) => void
  onOpen: (entry: BaseKnowledgeEntry) => void
}

export function EntryTable({
  entries,
  canManage,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
}: EntryTableProps): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const phone = usePhoneLayout()
  const allOn = entries.length > 0 && entries.every((entry) => selected.has(entry.id))
  const someOn = !allOn && entries.some((entry) => selected.has(entry.id))
  return (
    <Table className="table-fixed" data-testid="base-knowledge-table">
      <TableHeader>
        <TableRow>
          {canManage && (
            <TableHead className="w-10">
              <Checkbox
                aria-label={t('column.selectAll')}
                checked={allOn ? true : someOn ? 'indeterminate' : false}
                onCheckedChange={(checked) => onToggleAll(checked === true)}
              />
            </TableHead>
          )}
          <TableHead>{t('column.entry')}</TableHead>
          <TableHead className="w-28 max-md:hidden">{t('column.kind')}</TableHead>
          <TableHead className="w-32 max-lg:hidden">{t('column.edition')}</TableHead>
          {!phone && <TableHead className="w-48">{t('column.status')}</TableHead>}
          <TableHead className="w-48 max-md:hidden">{t('column.text')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow
            key={entry.id}
            data-testid="base-knowledge-row"
            data-state={selected.has(entry.id) ? 'selected' : undefined}
            className="cursor-pointer"
            onClick={() => onOpen(entry)}
          >
            {canManage && (
              <TableCell onClick={(event) => event.stopPropagation()}>
                <Checkbox
                  aria-label={t('column.select')}
                  checked={selected.has(entry.id)}
                  onCheckedChange={(checked) => onToggle(entry.id, checked === true)}
                />
              </TableCell>
            )}
            <TableCell className="w-full max-w-0">
              <button
                type="button"
                className="focus-visible:ring-ring rounded-control block w-full min-w-0 text-left focus-visible:ring-2 focus-visible:outline-none"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpen(entry)
                }}
              >
                <EntryName entry={entry} />
              </button>
              {phone && (
                <span className="mt-1 flex">
                  <StatusChip entry={entry} />
                </span>
              )}
            </TableCell>
            <TableCell className="text-sm whitespace-nowrap max-md:hidden">
              {t(`kind.${entry.values.kind}`)}
            </TableCell>
            <TableCell className="text-sm whitespace-nowrap tabular-nums max-lg:hidden">
              {entry.values.editionLabel}
            </TableCell>
            {!phone && (
              <TableCell>
                <StatusChip entry={entry} />
              </TableCell>
            )}
            <TableCell className="max-md:hidden">
              <TextUseChip entry={entry} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
