'use client'

/**
 * The actions on the topics of „Mein Gedächtnis“ (ADR-0180): rename or merge a
 * topic, ungroup it, remove it with every note on it, and move one note to
 * another topic. Only the person's own notes are touched: the routes read and
 * write as the person, and the names are normalized and resolved on the server
 * (`resolveTopic`), so the client only refuses a name too long to be a topic.
 *
 * Each write calls `onChanged` after it lands, and the panel reads the list
 * again: the topic counts come from that list, not from here.
 */

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

/** The topic's own actions, in the topic's heading. The no-topic group has none: there is nothing to rename, merge or remove. */
export function PersonalTopicActions({
  topic,
  count,
  topics,
  onChanged,
}: {
  topic: string | null
  /** How many of the person's notes are on the topic: what the removal says it deletes. */
  count: number
  /** The person's topics, the merge targets a rename offers. */
  topics: string[]
  onChanged: () => void
}): JSX.Element | null {
  const t = useTranslations(memoryTopicsCopy)
  const shared = useTranslations(personalMemoryCopy)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [removing, setRemoving] = useState(false)

  if (topic === null) return null

  /** Runs one write, then reads the list again; a failure says so, changes nothing and resolves false. */
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

  // A name another topic has merges the notes into it; the server resolves the spelling against the shelf.
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

/**
 * One note's topic, changed in place: a topic field that offers the shelf's
 * topics. A change PATCHes the note, and a failure puts the field back on the
 * note's own topic.
 */
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
  /** Bumped on a failure: the picker is keyed by it, so it shows the note's topic again. */
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
