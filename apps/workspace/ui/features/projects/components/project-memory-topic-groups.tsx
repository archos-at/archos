'use client'

/**
 * The notes of a project's memory shelf, as folders by topic (ADR-0180): one
 * row per note with its controls. The panel owns the data, the edit draft and
 * the delete dialog; this file draws what they hold. Inside a folder the notes
 * keep the kind order the panel listed kinds in.
 */

import type { JSX, ReactNode } from 'react'
import { Check, CircleAlert, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { SourceDeletedNote } from '@/components/projects/source-deleted-note'
import {
  MemoryNoteAction,
  MemoryNoteActions,
  MemoryNoteEditor,
  MemoryNoteItem,
  MemoryNoteText,
} from '@/components/memory/memory-note-parts'
import { useMemoryKindLabels } from '@/components/memory/memory-kinds'
import { TopicFolders } from '@/components/memory/topic-folders'
import { Badge } from '@/components/ui/badge'
import { ItemContent } from '@/components/ui/item'
import { FolderAccessMark } from '@/features/documents/components/folder-access-mark'
import { useLocale, useTranslations } from '@/i18n'
import type { Translator } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { PROJECT_MEMORY_KINDS, type ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import type { MemoryTopicCount } from '@/lib/memory-topics/topic'
import { ProjectNoteTopicMove, ProjectTopicActions } from './project-topic-actions'

/** Memory item as it arrives over the wire (timestamps serialize to strings). */
export type MemoryItem = Omit<ProjectMemoryItem, 'createdAt' | 'updatedAt' | 'lastReferencedAt'> & {
  createdAt: string
  updatedAt: string
  lastReferencedAt: string | null
  /** The folders a restricted note (ADR-0087) is restricted to; only ever sent to a cleared reader. */
  restrictedFolderNames?: string[]
  /** When a folder the note came from was purged (ADR-0088): „Quelle gelöscht am …". */
  sourceDeletedAt?: string
}

/**
 * The tooltip on a restricted note's lock: the folders it came from, when
 * known, and whether a language model helped decide that (ADR-0087; AI Act).
 */
function restrictionTitle(item: MemoryItem, t: Translator): string {
  const folders = item.restrictedFolderNames ?? []
  const where =
    folders.length > 0
      ? t('memory.restricted.title', { folders: folders.join(', ') })
      : t('memory.restricted.titleUnknown')
  if (!item.restrictionJudge) return where
  const judge = item.restrictionJudge === 'failed' ? t('memory.restricted.judgeFailed') : t('memory.restricted.judged')
  return `${where} ${judge}`
}

const KNOWN_VERIFICATIONS = ['unverified', 'source_grounded', 'user_confirmed']

function verificationLabel(verification: string, t: Translator): string {
  return KNOWN_VERIFICATIONS.includes(verification)
    ? t(`memory.verification.${verification}`)
    : verification
}

const KNOWN_CONFIDENCES = ['low', 'medium', 'high']

/** „Sicherheit: mittel“, never the stored token; a value this build does not know is shown as it is. */
function confidenceLabel(confidence: string, t: Translator): string {
  return KNOWN_CONFIDENCES.includes(confidence) ? t(`memory.confidence.${confidence}`) : confidence
}

function provenanceLabel(provenanceType: string, t: Translator): string {
  return provenanceType === 'user' ? t('memory.provenance.user') : t('memory.provenance.grid')
}

/** Compact relative time ("2h ago", "3d ago") with a date fallback for older items. */
function formatWhen(isoDate: string, t: Translator, locale: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  // floor, not round: 3,570s would otherwise render as "60 minutes ago"
  // instead of "1 hour ago" (same at the hour/day boundaries).
  if (seconds < 60) return t('memory.time.justNow')
  if (seconds < 3600) return t('memory.time.minutesAgo', { count: Math.floor(seconds / 60) })
  if (seconds < 86400) return t('memory.time.hoursAgo', { count: Math.floor(seconds / 3600) })
  if (seconds < 86400 * 30) return t('memory.time.daysAgo', { count: Math.floor(seconds / 86400) })
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/** What the panel hands each note: its edit draft, its busy state and the mutations that answer for it. */
export interface ProjectMemoryNoteControls {
  busyId: string | null
  editingId: string | null
  editDraft: string
  onEditDraftChange: (draft: string) => void
  onStartEdit: (item: MemoryItem) => void
  onCancelEdit: () => void
  onSaveEdit: (item: MemoryItem) => void
  onPatch: (item: MemoryItem, body: Record<string, unknown>) => void
  onAskRemove: (id: string) => void
}

export interface ProjectMemoryTopicGroupsProps {
  projectId: string
  /** The notes the panel shows (no superseded or dismissed ones). */
  items: MemoryItem[]
  /** Every note the reader got: a conflict names the note it contradicts, which may be hidden from the list. */
  allItems: MemoryItem[]
  /** The shelf's topics with their counts, as the server computed them for this reader. */
  topics: MemoryTopicCount[]
  readOnly: boolean
  controls: ProjectMemoryNoteControls
  /** After a topic is renamed, merged or ungrouped, or a note moved: the panel reloads the shelf. */
  onChanged: () => void
}

/** The kind order inside a folder: the order the kinds are listed in, unknown kinds last. */
function kindRank(kind: string): number {
  const rank = (PROJECT_MEMORY_KINDS as readonly string[]).indexOf(kind)
  return rank === -1 ? PROJECT_MEMORY_KINDS.length : rank
}

export function ProjectMemoryTopicGroups({
  projectId,
  items,
  allItems,
  topics,
  readOnly,
  controls,
  onChanged,
}: ProjectMemoryTopicGroupsProps): JSX.Element {
  const topicNames = topics.map((entry) => entry.name)
  const ordered = [...items].sort((a, b) => kindRank(a.kind) - kindRank(b.kind))
  const renderTopicActions = (topic: string | null): ReactNode => {
    if (topic === null) return null
    const count = topics.find((entry) => entry.name === topic)?.count ?? 0
    return (
      <ProjectTopicActions projectId={projectId} topic={topic} count={count} onChanged={onChanged} />
    )
  }
  return (
    <TopicFolders
      items={ordered}
      topics={topics}
      renderItem={(item) => (
        <ProjectMemoryNote
          item={item}
          projectId={projectId}
          topicNames={topicNames}
          allItems={allItems}
          readOnly={readOnly}
          controls={controls}
          onChanged={onChanged}
        />
      )}
      renderTopicActions={readOnly ? undefined : renderTopicActions}
    />
  )
}

interface ProjectMemoryNoteProps {
  item: MemoryItem
  projectId: string
  topicNames: string[]
  allItems: MemoryItem[]
  readOnly: boolean
  controls: ProjectMemoryNoteControls
  onChanged: () => void
}

function ProjectMemoryNote({
  item,
  projectId,
  topicNames,
  allItems,
  readOnly,
  controls,
  onChanged,
}: ProjectMemoryNoteProps): JSX.Element {
  const t = useTranslations(projectsCopy)
  const { locale } = useLocale()
  const kindLabels = useMemoryKindLabels()
  const busy = controls.busyId === item.id
  const isEditing = controls.editingId === item.id
  /**
   * What the conflict badge says on hover: the note this one contradicts, by
   * its own words. An agent finding that disagreed with a pinned, confirmed or
   * user-written note was not allowed to retire it (`conflictsWithId`), so the
   * two stand side by side — and without this the pair reads as a duplicate
   * nobody can explain.
   */
  const conflicting = allItems.find((it) => it.id === item.conflictsWithId)
  const conflictTitle = conflicting
    ? t('memory.conflict.title', { note: conflicting.content })
    : t('memory.conflict.titleUnknown')

  return (
    <MemoryNoteItem>
      <ItemContent>
        {isEditing ? (
          <MemoryNoteEditor
            id={`memory-edit-${item.id}`}
            label={t('memory.edit')}
            value={controls.editDraft}
            onChange={controls.onEditDraftChange}
            onSave={() => controls.onSaveEdit(item)}
            onCancel={controls.onCancelEdit}
            busy={busy}
            saveLabel={t('memory.save')}
            cancelLabel={t('memory.cancel')}
          />
        ) : (
          <>
            <MemoryNoteText pinned={item.pinned} pinnedLabel={t('memory.pinned')}>
              {item.content}
            </MemoryNoteText>
            {item.restrictedFolderIds && item.restrictedFolderIds.length > 0 && (
              <Badge
                variant="outline"
                className="text-muted-foreground mt-1.5"
                data-testid="memory-restricted"
              >
                <FolderAccessMark
                  names={item.restrictedFolderNames ?? []}
                  label={restrictionTitle(item, t)}
                />
                {t('memory.restricted.badge')}
                {item.restrictionJudge && (
                  <span data-testid="memory-restriction-judged">
                    {' · '}
                    {t('memory.restricted.judgedBadge')}
                  </span>
                )}
              </Badge>
            )}
            {item.sourceDeletedAt && (
              <SourceDeletedNote at={item.sourceDeletedAt} className="mt-1" />
            )}
            {item.conflictsWithId && (
              <Badge
                variant="outline"
                className="text-muted-foreground mt-1.5"
                title={conflictTitle}
                data-testid="memory-conflict"
              >
                <CircleAlert aria-hidden />
                {t('memory.conflict.badge')}
              </Badge>
            )}
            <p className="text-muted-foreground mt-1 text-xs">
              {item.scope === 'organization' && (
                <>
                  <span className="font-medium">{t('memory.orgWide')}</span>
                  {' · '}
                </>
              )}
              {kindLabels.kind(item.kind)}
              {' · '}
              {confidenceLabel(item.confidence, t)}
              {' · '}
              {verificationLabel(item.verification, t)}
              {' · '}
              {provenanceLabel(item.provenanceType, t)}
              {' · '}
              {formatWhen(item.updatedAt, t, locale)}
            </p>
            {!readOnly && (
              <ProjectNoteTopicMove
                projectId={projectId}
                item={item}
                topics={topicNames}
                onChanged={onChanged}
              />
            )}
          </>
        )}
      </ItemContent>

      {!isEditing && !readOnly && (
        <MemoryNoteActions>
          <MemoryNoteAction
            icon={item.pinned ? PinOff : Pin}
            label={item.pinned ? t('memory.unpin') : t('memory.pin')}
            title={item.pinned ? t('memory.unpinTitle') : t('memory.pinTitle')}
            onClick={() => controls.onPatch(item, { pinned: !item.pinned })}
            disabled={busy}
          />
          {item.verification !== 'user_confirmed' && (
            <MemoryNoteAction
              icon={Check}
              label={t('memory.confirm')}
              title={t('memory.confirmTitle')}
              onClick={() => controls.onPatch(item, { verification: 'user_confirmed' })}
              disabled={busy}
            />
          )}
          <MemoryNoteAction
            icon={Pencil}
            label={t('memory.edit')}
            title={t('memory.editTitle')}
            onClick={() => controls.onStartEdit(item)}
            disabled={busy}
          />
          <MemoryNoteAction
            icon={Trash2}
            label={t('memory.removeAria')}
            title={t('memory.removeTitle')}
            onClick={() => controls.onAskRemove(item.id)}
            disabled={busy}
            destructive
          />
        </MemoryNoteActions>
      )}
    </MemoryNoteItem>
  )
}
