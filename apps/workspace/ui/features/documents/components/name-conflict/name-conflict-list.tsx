'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTransientFlag } from '@/hooks/use-transient-flag'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { conflictListText, type ConflictChoice, type ConflictOperation, type ConflictRow } from '../../lib/name-conflict'

export interface NameConflictListProps {
  rows: readonly ConflictRow[]
  operation: ConflictOperation
  onChoose?: (keys: readonly string[], choice: ConflictChoice) => void
  disabled?: boolean
}

const choicesOf = (row: ConflictRow): readonly ConflictChoice[] =>
  row.within === 'folder' ? ['replace', 'keep_both', 'skip'] : ['keep_both', 'skip']

const CHOICE_LABEL = { replace: 'replace', keep_both: 'keepBoth', skip: 'skip' } as const

export function NameConflictList({ rows, operation, onChoose, disabled = false }: NameConflictListProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const [forAll, setForAll] = useState(false)
  const [copied, raiseCopied] = useTransientFlag()
  const locked = disabled || !onChoose

  const chooseForAll = (choice: ConflictChoice): void =>
    onChoose?.(
      rows.filter((each) => choicesOf(each).includes(choice)).map((each) => each.key),
      choice,
    )

  const choose = (row: ConflictRow, choice: ConflictChoice): void => {
    if (forAll) chooseForAll(choice)
    else onChoose?.([row.key], choice)
  }

  const applyToAll = (checked: boolean): void => {
    setForAll(checked)
    if (checked && rows[0]) chooseForAll(rows[0].choice)
  }

  const copy = (): void => {
    void navigator.clipboard?.writeText(conflictListText(rows.map((row) => row.path))).then(raiseCopied, () => {})
  }

  const outcome = (row: ConflictRow): string => {
    if (row.choice === 'replace') return t(`nameConflicts.outcome.${operation}Replace`, { name: row.existingName ?? row.name })
    if (row.choice === 'keep_both') return t('nameConflicts.outcome.keepBoth', { name: row.keepBothAs })
    return t(`nameConflicts.outcome.${operation}Skip`)
  }

  return (
    <div className="space-y-2" data-testid="name-conflict-list">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {rows.length > 1 ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={forAll}
              onCheckedChange={(checked) => applyToAll(checked === true)}
              disabled={locked}
              data-testid="name-conflict-apply-all"
            />
            {t('nameConflicts.applyToAll')}
          </label>
        ) : (
          <span />
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={copy}
          aria-label={t('nameConflicts.copyAria', { count: rows.length })}
          data-testid="name-conflict-copy"
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? t('nameConflicts.copied') : t('nameConflicts.copy')}
        </Button>
      </div>
      <ul className="divide-y">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
            data-testid="name-conflict-row"
          >
            <div className="min-w-0 space-y-0.5">
              <p className="font-mono text-xs text-foreground [overflow-wrap:anywhere]">{row.path}</p>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]" data-testid="name-conflict-outcome">
                {outcome(row)}
              </p>
            </div>
            <ToggleGroup
              type="single"
              segmented
              size="sm"
              value={row.choice}
              onValueChange={(value) => {
                if (value) choose(row, value as ConflictChoice)
              }}
              disabled={locked}
              aria-label={t('nameConflicts.choiceFor', { name: row.path })}
              className="shrink-0"
            >
              {choicesOf(row).map((choice) => (
                <ToggleGroupItem
                  key={choice}
                  value={choice}
                  className="text-xs"
                  title={choice === 'keep_both' ? t('nameConflicts.keepBothAs', { name: row.keepBothAs }) : undefined}
                  data-testid={`name-conflict-${choice}`}
                >
                  {t(`nameConflicts.${CHOICE_LABEL[choice]}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </li>
        ))}
      </ul>
    </div>
  )
}
