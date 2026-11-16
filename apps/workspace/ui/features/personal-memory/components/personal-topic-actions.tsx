'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { Pencil, Trash2, Ungroup } from 'lucide-react'
import { toast } from 'sonner'
import {
  removePersonalMemoryTopic,
  renamePersonalMemoryTopic,
  updatePersonalMemoryNote,
} from '@/adapters/api/personal-memory-client'
import { TopicPicker } from '@/components/memory/topic-picker'
import { TopicRenameDialog } from '@/components/memory/topic-rename-dialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { memoryTopicsCopy } from '@/i18n/namespaces/memory-topics'
import { personalMemoryCopy } from '@/i18n/namespaces/personal-memory'

export function PersonalTopicActions({
  topic,
  count,
  topics,
  onChanged,
}: {
  topic: string | null
  count: number
  topics: string[]
  onChanged: () => void
}): JSX.Element | null {
  const t = useTranslations(memoryTopicsCopy)
  const shared = useTranslations(personalMemoryCopy)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [removing, setRemoving] = useState(false)

  if (topic === null) return null

  const runWrite = async (task: () => Promise<unknown>, failure: string): Promise<boolean> => {
    setBusy(true)
    try {
      await task()
      onChanged()
      return true
    } catch {
      toast.error(failure)
      return false
    } finally {
      setBusy(false)
    }
  }

  const rename = (to: string): Promise<boolean> =>
    runWrite(() => renamePersonalMemoryTopic({ from: topic, to }), shared('errors.saveFailed'))

  const ungroup = (): Promise<boolean> =>
    runWrite(() => renamePersonalMemoryTopic({ from: topic, to: null }), shared('errors.saveFailed'))

  const remove = async (): Promise<void> => {
    await runWrite(async () => {
      await removePersonalMemoryTopic(topic)
      setRemoving(false)
    }, shared('errors.removeFailed'))
  }

  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="personal-topic-actions">
      <Button variant="ghost" size="sm" onClick={() => setRenaming(true)} disabled={busy}>
        <Pencil className="size-4" aria-hidden />
        {t('rename')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void ungroup()} disabled={busy}>
        <Ungroup className="size-4" aria-hidden />
        {t('ungroup')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setRemoving(true)} disabled={busy}>
        <Trash2 className="text-destructive size-4" aria-hidden />
        {t('removeTopic')}
      </Button>

      <TopicRenameDialog
        open={renaming}
        topic={topic}
        topics={topics}
        onOpenChange={setRenaming}
        onRename={rename}
      />

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        tone="destructive"
        title={t('removeTopic')}
        description={t('removeTopicConfirm', { count, name: topic })}
        confirmLabel={t('removeTopic')}
        cancelLabel={shared('cancel')}
        pending={busy}
        onConfirm={remove}
      />
    </div>
  )
}

export function PersonalNoteTopicMove({
  item,
  topics,
  onChanged,
}: {
  item: { id: string; topic: string | null }
  topics: string[]
  onChanged: () => void
}): JSX.Element {
  const shared = useTranslations(personalMemoryCopy)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const move = async (topic: string | null): Promise<void> => {
    setBusy(true)
    try {
      await updatePersonalMemoryNote(item.id, { topic })
      onChanged()
    } catch {
      setAttempt((count) => count + 1)
      toast.error(shared('errors.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <TopicPicker
      key={attempt}
      compact
      topics={topics}
      value={item.topic}
      disabled={busy}
      onChange={(topic) => void move(topic)}
      data-testid="personal-note-topic"
    />
  )
}
