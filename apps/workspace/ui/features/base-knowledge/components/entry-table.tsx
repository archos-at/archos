'use client'

/**
 * The office standards as a table: what it is, its kind and edition, its
 * status, what happens to its text and when it was last checked. A row opens
 * the entry's sheet; its checkbox selects it for a bulk action. The order is
 * the server's: what needs a person first.
 */

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
import { useLocale, useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import type { BaseKnowledgeEntry } from '@/lib/base-knowledge/wire'
import { EntryName, LastChecked, StatusChip, TextUseChip } from './entry-atoms'

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
  const { locale } = useLocale()
  const allOn = entries.length > 0 && entries.every((entry) => selected.has(entry.id))
  const someOn = !allOn && entries.some((entry) => selected.has(entry.id))
  return (
    <Table data-testid="base-knowledge-table">
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
          <TableHead className="max-md:hidden">{t('column.kind')}</TableHead>
          <TableHead className="max-lg:hidden">{t('column.edition')}</TableHead>
          <TableHead>{t('column.status')}</TableHead>
          <TableHead className="max-md:hidden">{t('column.text')}</TableHead>
          <TableHead className="max-lg:hidden">{t('column.checked')}</TableHead>
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
            </TableCell>
            <TableCell className="text-sm whitespace-nowrap max-md:hidden">
              {t(`kind.${entry.values.kind}`)}
            </TableCell>
            <TableCell className="text-sm whitespace-nowrap tabular-nums max-lg:hidden">
              {entry.values.editionLabel}
            </TableCell>
            <TableCell>
              <StatusChip entry={entry} />
            </TableCell>
            <TableCell className="max-md:hidden">
              <TextUseChip entry={entry} />
            </TableCell>
            <TableCell className="whitespace-nowrap max-lg:hidden">
              <LastChecked entry={entry} locale={locale} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
