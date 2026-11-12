'use client'

/**
 * TopicPicker: the topic of one memory note, picked or typed (ADR-0180). The
 * field offers the shelf's existing topics as the person types, with „Ohne
 * Thema“ first while it is empty; Enter or leaving the field takes what is
 * typed, through `resolveTopic`, so "brandschutz" lands in the shelf's
 * "Brandschutz" and not in a second topic. Longer than the topic bound the
 * field says so and takes nothing.
 *
 * Knows no shelf: the caller passes the topics it may show and what a choice
 * does. The one door for a topic's spelling is `@/lib/memory-topics/topic`.
 */

import type { JSX } from 'react'
import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SuggestInput, type SuggestOption } from '@/components/ui/suggest-input'
import { useTranslations } from '@/i18n'
import { memoryTopicsCopy } from '@/i18n/namespaces/memory-topics'
import { resolveTopic } from '@/lib/memory-topics/topic'

/** The option that means no topic. A topic is never empty, so the value cannot collide with one. */
const NO_TOPIC = ''

export interface TopicPickerProps {
  /** The shelf's topics, the ones the field offers. */
  topics: string[]
  /** The note's topic now; null for no topic. */
  value: string | null
  onChange: (topic: string | null) => void
  disabled?: boolean
  /** The field's accessible name. Default: the topic label. */
  label?: string
  id?: string
  /**
   * A small button, "Verschieben nach …", that opens the same field in a popover and closes it on a
   * pick: for a note's topic in a list, where the field would otherwise sit beside every note.
   */
  compact?: boolean
  'data-testid'?: string
}

type TopicFieldProps = Omit<TopicPickerProps, 'compact'>

/** The topic a raw entry means on this shelf, or null when it is too long to be one. */
function topicFor(raw: string, topics: readonly string[]): { topic: string | null } | null {
  try {
    return { topic: resolveTopic(raw, topics) }
  } catch {
    return null
  }
}

export function TopicPicker({ compact = false, ...field }: TopicPickerProps): JSX.Element {
  return compact ? <CompactTopicPicker {...field} /> : <TopicField {...field} />
}

/** The field behind a button: the button says what the field is for, a pick closes the popover and hands the topic over. */
function CompactTopicPicker({
  topics,
  value,
  onChange,
  disabled = false,
  label,
  id,
  'data-testid': testId,
}: TopicFieldProps): JSX.Element {
  const t = useTranslations(memoryTopicsCopy)
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled} data-testid={testId}>
          {t('moveTo')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <TopicField
          topics={topics}
          value={value}
          onChange={(topic) => {
            setOpen(false)
            onChange(topic)
          }}
          label={label}
          id={id}
        />
      </PopoverContent>
    </Popover>
  )
}

function TopicField({
  topics,
  value,
  onChange,
  disabled = false,
  label,
  id,
  'data-testid': testId,
}: TopicFieldProps): JSX.Element {
  const t = useTranslations(memoryTopicsCopy)
  const generatedId = useId()
  const [draft, setDraft] = useState(value ?? '')
  // The field follows the note when its topic changes from outside (a list reload, another action).
  const [shownValue, setShownValue] = useState(value)
  if (shownValue !== value) {
    setShownValue(value)
    setDraft(value ?? '')
  }

  const tooLong = topicFor(draft, topics) === null
  const errorId = `${generatedId}-error`
  const noTopicLabel = t('noTopic')

  const options = useMemo<SuggestOption[]>(() => {
    const query = draft.trim().toLocaleLowerCase('de')
    if (query === '') {
      return [{ value: NO_TOPIC, label: noTopicLabel }, ...topics.map((name) => ({ value: name, label: name }))]
    }
    return topics
      .filter((name) => name.toLocaleLowerCase('de').includes(query))
      .map((name) => ({ value: name, label: name }))
  }, [draft, topics, noTopicLabel])

  /** Hands a topic to the caller, unless it is the note's own; the field shows what was taken. */
  const apply = (topic: string | null): void => {
    setDraft(topic ?? '')
    if (topic !== value) onChange(topic)
  }

  const commit = (): void => {
    const resolved = topicFor(draft, topics)
    if (resolved) apply(resolved.topic)
  }

  return (
    <div className="min-w-0" data-testid={testId}>
      <SuggestInput
        id={id}
        value={draft}
        onValueChange={setDraft}
        options={options}
        onPick={(option) => apply(option.value === NO_TOPIC ? null : option.value)}
        onCommit={commit}
        listLabel={label ?? t('filterLabel')}
        aria-label={label ?? t('filterLabel')}
        placeholder={value === null ? noTopicLabel : t('newTopic')}
        disabled={disabled}
        aria-invalid={tooLong || undefined}
        aria-describedby={tooLong ? errorId : undefined}
      />
      {tooLong && (
        <p id={errorId} className="text-destructive mt-1 text-xs">
          {t('topicTooLong')}
        </p>
      )}
    </div>
  )
}
