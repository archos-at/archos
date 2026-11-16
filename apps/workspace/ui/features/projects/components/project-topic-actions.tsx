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

export interface ProjectTopicActionsProps {
  projectId: string
  topic: string | null
  mergeTargets: readonly string[]
  holdsOfficeNotes?: boolean
  onChanged: () => void
}

export function ProjectTopicActions({
  projectId,
  topic,
  mergeTargets,
  holdsOfficeNotes = false,
  onChanged,
}: ProjectTopicActionsProps): JSX.Element | null {
  const t = useTranslations(memoryTopicsCopy)
  const tProject = useTranslations(projectsCopy)
  const [renaming, setRenaming] = useState(false)
  const [pending, setPending] = useState(false)

  if (topic === null) return null

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
        officeKeepsTopic={holdsOfficeNotes}
        onOpenChange={setRenaming}
        onRename={(to) => change(to)}
      />
    </>
  )
}

export interface ProjectNoteTopicMoveProps {
  projectId: string
  item: Pick<ProjectMemoryItem, 'id' | 'scope' | 'topic'>
  topics: string[]
  onChanged: () => void
}

export function ProjectNoteTopicMove({ projectId, item, topics, onChanged }: ProjectNoteTopicMoveProps): JSX.Element {
  const t = useTranslations(memoryTopicsCopy)
  const tProject = useTranslations(projectsCopy)
  const [pending, setPending] = useState(false)
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
