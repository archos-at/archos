'use client'

import type { JSX } from 'react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { ConflictChoice } from '../../lib/name-conflict'
import type { AskedQuestion, ConflictAnswer, NameConflictPrompt } from '../../hooks/use-name-conflict-prompt'
import { NameConflictList } from './name-conflict-list'

export function NameConflictDialog({ prompt }: { prompt: Pick<NameConflictPrompt, 'question' | 'resolve'> }): JSX.Element {
  const t = useTranslations(filesCopy)
  const { question, resolve } = prompt
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <Dialog open={question !== null} onOpenChange={(open) => !open && resolve(null)}>
      <DialogContent
        ref={contentRef}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.focus()
        }}
        className="flex max-h-[min(44rem,90dvh)] flex-col gap-0 p-0 outline-none! sm:max-w-xl"
        closeLabel={t('nameConflicts.dialog.cancel')}
        data-testid="name-conflict-dialog"
        data-operation={question?.operation ?? 'upload'}
      >
        {question && <QuestionBody key={question.id} question={question} resolve={resolve} />}
      </DialogContent>
    </Dialog>
  )
}

function QuestionBody({
  question,
  resolve,
}: {
  question: AskedQuestion
  resolve: (choices: ConflictAnswer | null) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const [choices, setChoices] = useState<ReadonlyMap<string, ConflictChoice>>(
    () => new Map(question.rows.map((row) => [row.key, row.choice]))
  )
  const rows = question.rows.map((row) => ({ ...row, choice: choices.get(row.key) ?? row.choice }))
  const { operation } = question
  const sending = rows.filter((row) => row.choice !== 'skip').length

  return (
    <>
      <DialogHeader className="px-4 pt-6 pb-4 pr-12 text-left sm:px-6">
        <DialogTitle className="leading-snug">
          {t(`nameConflicts.dialog.${operation}Title`, { count: rows.length, folder: question.folderName })}
        </DialogTitle>
        <DialogDescription>{t('nameConflicts.dialog.description')}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-3 sm:px-6">
        <NameConflictList
          rows={rows}
          operation={operation}
          onChoose={(keys, choice) =>
            setChoices((previous) => new Map([...previous, ...keys.map((key) => [key, choice] as const)]))
          }
        />
      </div>
      <DialogFooter className="border-t px-4 pt-4 pb-6 sm:px-6">
        <Button variant="secondary" onClick={() => resolve(null)}>
          {t('nameConflicts.dialog.cancel')}
        </Button>
        <Button onClick={() => resolve(new Map(rows.map((row) => [row.key, row.choice])))} data-testid="name-conflict-confirm">
          {sending === 0 ? t('nameConflicts.dialog.skipAll') : t(`nameConflicts.dialog.${operation}Confirm`, { count: sending })}
        </Button>
      </DialogFooter>
    </>
  )
}
