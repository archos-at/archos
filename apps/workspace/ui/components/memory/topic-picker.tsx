'use client'

import type { JSX } from 'react'
import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SuggestInput, type SuggestOption } from '@/components/ui/suggest-input'
import { useTranslations } from '@/i18n'
import { memoryTopicsCopy } from '@/i18n/namespaces/memory-topics'
import { resolveTopic } from '@/lib/memory-topics/topic'

const NO_TOPIC = ''

export interface TopicPickerProps {
  topics: string[]
  value: string | null
  onChange: (topic: string | null) => void
  disabled?: boolean
  label?: string
  id?: string
  compact?: boolean
  'data-testid'?: string
}

type TopicFieldProps = Omit<TopicPickerProps, 'compact'> & {
  commitOnBlur?: boolean
}

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
          commitOnBlur={false}
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
  commitOnBlur,
  'data-testid': testId,
}: TopicFieldProps): JSX.Element {
  const t = useTranslations(memoryTopicsCopy)
  const generatedId = useId()
  const [draft, setDraft] = useState(value ?? '')
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
        commitOnBlur={commitOnBlur}
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
