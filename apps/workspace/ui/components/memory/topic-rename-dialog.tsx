'use client'

import type { JSX } from 'react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { SuggestInput, type SuggestOption } from '@/components/ui/suggest-input'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { memoryTopicsCopy } from '@/i18n/namespaces/memory-topics'
import { normalizeTopic } from '@/lib/memory-topics/topic'

function typedTopic(raw: string): { topic: string | null; tooLong: boolean } {
  try {
    return { topic: normalizeTopic(raw), tooLong: false }
  } catch {
    return { topic: null, tooLong: true }
  }
}

function mergeOptions(name: string, topic: string, topics: readonly string[]): SuggestOption[] {
  const query = name === topic ? '' : name.trim().toLocaleLowerCase('de')
  return topics
    .filter((other) => other !== topic && other.toLocaleLowerCase('de').includes(query))
    .map((other) => ({ value: other, label: other }))
}

export interface TopicRenameDialogProps {
  open: boolean
  topic: string
  topics: readonly string[]
  officeKeepsTopic?: boolean
  onOpenChange: (open: boolean) => void
  onRename: (to: string) => Promise<boolean>
}

export function TopicRenameDialog({
  open,
  topic,
  topics,
  officeKeepsTopic = false,
  onOpenChange,
  onRename,
}: TopicRenameDialogProps): JSX.Element {
  const [pending, setPending] = useState(false)

  const submit = async (to: string): Promise<boolean> => {
    setPending(true)
    try {
      return await onRename(to)
    } catch {
      return false
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <RenameForm
          topic={topic}
          topics={topics}
          officeKeepsTopic={officeKeepsTopic}
          pending={pending}
          onCancel={() => onOpenChange(false)}
          onSubmit={async (to) => {
            if (await submit(to)) onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

interface RenameFormProps {
  topic: string
  topics: readonly string[]
  officeKeepsTopic: boolean
  pending: boolean
  onCancel: () => void
  onSubmit: (to: string) => Promise<void>
}

function RenameForm({ topic, topics, officeKeepsTopic, pending, onCancel, onSubmit }: RenameFormProps): JSX.Element {
  const t = useTranslations(memoryTopicsCopy)
  const tCommon = useTranslations(commonCopy)
  const inputId = useId()
  const errorId = `${inputId}-error`
  const [name, setName] = useState(topic)

  const typed = typedTopic(name)
  const canSave = typed.topic !== null && typed.topic !== topic && !pending

  const save = (): void => {
    if (!canSave || typed.topic === null) return
    void onSubmit(typed.topic)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('rename')}</DialogTitle>
        <DialogDescription>{t('mergeHint')}</DialogDescription>
        {officeKeepsTopic && <p className="text-muted-foreground text-sm">{t('officeKeepsTopic')}</p>}
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <Field>
          <FieldLabel htmlFor={inputId}>{t('renamePlaceholder')}</FieldLabel>
          <SuggestInput
            id={inputId}
            value={name}
            autoFocus
            enterKeyHint="done"
            disabled={pending}
            onValueChange={setName}
            options={mergeOptions(name, topic, topics)}
            onPick={(option) => setName(option.value)}
            onCommit={save}
            commitOnBlur={false}
            listLabel={t('rename')}
            aria-invalid={typed.tooLong || undefined}
            aria-describedby={typed.tooLong ? errorId : undefined}
          />
          {typed.tooLong && (
            <p id={errorId} className="text-destructive mt-1 text-xs">
              {t('topicTooLong')}
            </p>
          )}
        </Field>
        <DialogFooter className="mt-5">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            {tCommon('actions.cancel')}
          </Button>
          <Button type="submit" disabled={!canSave}>
            {tCommon('actions.save')}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
