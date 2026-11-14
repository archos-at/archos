'use client'

/**
 * Rename a memory topic, or merge it into another one (ADR-0180). The field offers
 * the merge targets the caller passes, and the caller decides which ones: a shelf
 * offers an open note's topic only the topics open notes hold, so a restricted
 * topic's name never reaches a reader who may not see it. The typed name is
 * normalized here (`normalizeTopic`); the server resolves it against the shelf's
 * own spelling, so "BRANDSCHUTZ" lands on an existing "Brandschutz".
 *
 * Shared by the personal and the project shelf. The caller mounts it with `open`;
 * the form starts from the topic's current name every time it opens.
 */

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

/** The normal form of a typed name (null for an empty one), or `tooLong` when it is over the bound. */
function typedTopic(raw: string): { topic: string | null; tooLong: boolean } {
  try {
    return { topic: normalizeTopic(raw), tooLong: false }
  } catch {
    return { topic: null, tooLong: true }
  }
}

/** The merge targets that fit the typed name. The topic itself is never one; the list starts with all of them. */
function mergeOptions(name: string, topic: string, topics: readonly string[]): SuggestOption[] {
  const query = name === topic ? '' : name.trim().toLocaleLowerCase('de')
  return topics
    .filter((other) => other !== topic && other.toLocaleLowerCase('de').includes(query))
    .map((other) => ({ value: other, label: other }))
}

export interface TopicRenameDialogProps {
  open: boolean
  /** The topic's name now. */
  topic: string
  /** The merge targets the field offers. The caller passes only what the reader may see here; `topic` itself is left out. */
  topics: readonly string[]
  /** The folder holds office notes, which a project's rename leaves under the topic's name. */
  officeKeepsTopic?: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Renames the topic to `to`; a name another topic already has merges the notes into it.
   * Resolves true when the shelf took the change, and the dialog then closes; a
   * refusal or a throw resolves false and the dialog stays open.
   */
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
  /** Hands over the normalized name; the form does nothing else on a save. */
  onSubmit: (to: string) => Promise<void>
}

/** The form inside the dialog. It is unmounted when the dialog closes, so each opening starts from the topic's name. */
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
