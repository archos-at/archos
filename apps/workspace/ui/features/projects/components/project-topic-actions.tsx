'use client'

import { useState } from 'react'
import type { JSX } from 'react'
import { toast } from 'sonner'
import { TopicPicker } from '@/components/memory/topic-picker'
import { TopicRenameDialog } from '@/components/memory/topic-rename-dialog'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { memoryTopicsCopy } from '@/i18n/namespaces/memory-topics'
import { projectsCopy } from '@/i18n/namespaces/projects'
import type { ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import { moveProjectMemoryNote, renameProjectMemoryTopic } from '@/adapters/api/project-memory-client'

/**
 * The topic actions of the project memory shelf (ADR-0180, the topics amendment):
 * rename or merge a topic, ungroup it, and move one note to another topic. Both
 * answer through the shelf's own routes, which apply the same gate as the note
 * PATCH; there is no remove-topic on the team shelf (a team's notes go one by one).
 */

export interface ProjectTopicActionsProps {
  projectId: string
  /** The group's topic; the group of notes with no topic has nothing to rename or ungroup. */
  topic: string | null
  /** The topics a rename may merge into: the ones open notes hold, never a restricted topic's name. */
  mergeTargets: readonly string[]
  /** Called after the shelf took a change, so the list reloads the groups. */
  onChanged: () => void
}

/** The rename and ungroup buttons of one topic group on the project shelf. */
export function ProjectTopicActions({
  projectId,
  topic,
  mergeTargets,
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
      await renameProjectMemoryTopic(projectId, { from: topic, to })
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
      <TopicRenameDialog
        open={renaming}
        topic={topic}
        topics={mergeTargets}
        onOpenChange={setRenaming}
        onRename={(to) => change(to)}
      />
    </>
  )
}

export interface ProjectNoteTopicMoveProps {
  projectId: string
  item: Pick<ProjectMemoryItem, 'id' | 'scope' | 'topic'>
  /** The topics the note may move to: all the reader sees for a restricted note, the open ones for an open note. */
  topics: string[]
  /** Called after the note took its new topic. */
  onChanged: () => void
}

/** Move one note (project or office) to another topic, or to none: a compact control that opens the picker. */
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
      await moveProjectMemoryNote(projectId, item, topic)
      onChanged()
    } catch {
      setAttempt((count) => count + 1)
      toast.error(tProject('memory.errors.updateFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <TopicPicker
      key={attempt}
      compact
      topics={topics}
      value={item.topic}
      label={t('moveTo')}
      disabled={pending}
      onChange={(topic) => void move(topic)}
    />
  )
}
