'use client'

import { useId, useState } from 'react'
import type { JSX } from 'react'
import { toast } from 'sonner'
import { TopicPicker } from '@/components/memory/topic-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { memoryTopicsCopy } from '@/i18n/namespaces/memory-topics'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { normalizeTopic } from '@/lib/memory-topics/topic'
import type { ProjectMemoryItem } from '@/lib/db/schema/project-memory'

/**
 * The topic actions of the project memory shelf (ADR-0180, the topics amendment):
 * rename or merge a topic, ungroup it, and move one note to another topic. Both
 * answer through the shelf's own routes, which apply the same gate as the note
 * PATCH; there is no remove-topic on the team shelf (a team's notes go one by one).
 */

const topicsUrl = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/memory/topics`

const itemUrl = (projectId: string, itemId: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/memory/${encodeURIComponent(itemId)}`

/** A note's own PATCH. An office note is the organization's, so it goes where the panel sends it (`project-memory-panel.tsx`). */
const noteUrl = (projectId: string, item: Pick<ProjectMemoryItem, 'id' | 'scope'>): string =>
  item.scope === 'organization'
    ? `/api/organization/memory/${encodeURIComponent(item.id)}`
    : itemUrl(projectId, item.id)

/** A PATCH that answers JSON, or throws for any status the shelf refuses. */
async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return (await response.json()) as T
}

/** The topic a typed name stands for, or why it does not: longer than the bound. Empty is no topic. */
function typedTopic(raw: string): { topic: string | null; tooLong: boolean } {
  try {
    return { topic: normalizeTopic(raw), tooLong: false }
  } catch {
    return { topic: null, tooLong: true }
  }
}

interface TopicRenameDialogProps {
  topic: string
  count: number
  pending: boolean
  onClose: () => void
  /** Resolves true when the shelf took the change. */
  onSubmit: (to: string) => Promise<boolean>
}

/**
 * Rename a topic. A name another topic already has merges the notes into it; the
 * hint says so before the person saves. Mounted only while open, so the field
 * starts from the topic's current name.
 */
function TopicRenameDialog({ topic, count, pending, onClose, onSubmit }: TopicRenameDialogProps): JSX.Element {
  const t = useTranslations(memoryTopicsCopy)
  const tCommon = useTranslations(commonCopy)
  const inputId = useId()
  const [name, setName] = useState(topic)

  const typed = typedTopic(name)
  const canSave = typed.topic !== null && typed.topic !== topic && !pending

  const save = async () => {
    const to = typed.topic
    if (to === null || to === topic) return
    if (await onSubmit(to)) onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('rename')}</DialogTitle>
          <DialogDescription>{t('topicCount', { count })}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (canSave) void save()
          }}
        >
          <Field>
            <FieldLabel htmlFor={inputId}>{t('renamePlaceholder')}</FieldLabel>
            <Input
              id={inputId}
              value={name}
              autoFocus
              enterKeyHint="done"
              aria-invalid={typed.tooLong || undefined}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="mt-1.5 text-sm text-muted-foreground">
              {typed.tooLong ? t('topicTooLong') : t('mergeHint')}
            </p>
          </Field>
          <DialogFooter className="mt-5">
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              {tCommon('actions.cancel')}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {tCommon('actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export interface ProjectTopicActionsProps {
  projectId: string
  /** The group's topic; the group of notes with no topic has nothing to rename or ungroup. */
  topic: string | null
  /** How many notes the reader sees on the topic. */
  count: number
  /** Called after the shelf took a change, so the list reloads the groups. */
  onChanged: () => void
}

/** The rename and ungroup buttons of one topic group on the project shelf. */
export function ProjectTopicActions({
  projectId,
  topic,
  count,
  onChanged,
}: ProjectTopicActionsProps): JSX.Element | null {
  const t = useTranslations(memoryTopicsCopy)
  const tProject = useTranslations(projectsCopy)
  const [renaming, setRenaming] = useState(false)
  const [pending, setPending] = useState(false)

  if (topic === null) return null

  /** Every notes-of-a-topic change: `to` null ungroups, another name renames or merges. */
  const change = async (to: string | null): Promise<boolean> => {
    setPending(true)
    try {
      await patchJson<{ moved: number }>(topicsUrl(projectId), { from: topic, to })
      onChanged()
      return true
    } catch {
      toast.error(tProject('memory.errors.updateFailed'))
      return false
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setRenaming(true)}>
          {t('rename')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void change(null)}>
          {t('ungroup')}
        </Button>
      </div>
      {renaming && (
        <TopicRenameDialog
          topic={topic}
          count={count}
          pending={pending}
          onClose={() => setRenaming(false)}
          onSubmit={change}
        />
      )}
    </>
  )
}

export interface ProjectNoteTopicMoveProps {
  projectId: string
  item: Pick<ProjectMemoryItem, 'id' | 'scope' | 'topic'>
  /** The topics the shelf has, as the list names them. */
  topics: string[]
  /** Called after the note took its new topic. */
  onChanged: () => void
}

/** Move one note (project or office) to another topic, or to none, with the note's own PATCH. */
export function ProjectNoteTopicMove({ projectId, item, topics, onChanged }: ProjectNoteTopicMoveProps): JSX.Element {
  const t = useTranslations(memoryTopicsCopy)
  const tProject = useTranslations(projectsCopy)
  const [pending, setPending] = useState(false)
  /** Bumped on a failure: the picker is keyed by it, so it shows the note's topic again. */
  const [attempt, setAttempt] = useState(0)

  const move = async (topic: string | null) => {
    if (topic === item.topic) return
    setPending(true)
    try {
      await patchJson<{ item: unknown }>(noteUrl(projectId, item), { topic })
      onChanged()
    } catch {
      setAttempt((count) => count + 1)
      toast.error(tProject('memory.errors.updateFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div role="group" aria-label={t('moveTo')}>
      <TopicPicker
        key={attempt}
        topics={topics}
        value={item.topic}
        disabled={pending}
        onChange={(topic) => void move(topic)}
      />
    </div>
  )
}
