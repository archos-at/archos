'use client'

/**
 * The notes of a project's memory shelf, as folders by topic (ADR-0180): one
 * row per note with its controls. The panel owns the data, the edit draft and
 * the delete dialog; this file draws what they hold. Inside a folder the notes
 * keep the kind order the panel listed kinds in. A shelf with no topic on any
 * note is grouped by kind instead, as it was before topics.
 */

import type { JSX, ReactNode } from 'react'
import { Fragment } from 'react'
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
import { ItemContent, ItemList } from '@/components/ui/item'
import { SectionLabel } from '@/components/ui/section-label'
import { FolderAccessMark } from '@/features/documents'
import { useLocale, useTranslations } from '@/i18n'
import type { Translator } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { PROJECT_MEMORY_KINDS, type ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import { distinctTopicNames, type MemoryTopicCount } from '@/lib/memory-topics/topic'
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

/**
 * The topics a note may be moved or added under (ADR-0087, ADR-0180). A restricted note may take any topic
 * the reader sees. An open note takes only a topic an open note holds, and an office note only a topic
 * an office note holds: a project's topic name never lands on a note the whole office reads.
 */
export function pickableTopicNames(
  items: readonly MemoryItem[],
  note: { scope: 'project' | 'organization'; restricted: boolean },
  visibleTopicNames: readonly string[]
): string[] {
  const sameScope = note.scope === 'organization' ? items.filter((item) => item.scope === 'organization') : items
  if (note.restricted) return note.scope === 'organization' ? distinctTopicNames(sameScope) : [...visibleTopicNames]
  return distinctTopicNames(sameScope.filter((item) => !item.restrictedFolderIds?.length))
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
  // A restricted note may be filed under any topic its reader sees. An open note may be
  // filed only under a topic an open note holds: a restricted topic's name must not reach
  // a note that everyone it is open to can read (ADR-0087).
  const allTopicNames = topics.map((entry) => entry.name)
  const openTopicNames = distinctTopicNames(items.filter((item) => !item.restrictedFolderIds?.length))
  const ordered = [...items].sort((a, b) => kindRank(a.kind) - kindRank(b.kind))
  // A topic only office notes hold has no project note for the shelf's rename or ungroup to
  // act on: the server would move nothing and answer so, so the folder offers no actions.
  const projectTopics = new Set(items.filter((item) => item.scope === 'project').map((item) => item.topic))
  const renderItem = (item: MemoryItem): ReactNode => (
    <ProjectMemoryNote
      item={item}
      projectId={projectId}
      topicNames={pickableTopicNames(
        items,
        { scope: item.scope, restricted: Boolean(item.restrictedFolderIds?.length) },
        allTopicNames
      )}
      allItems={allItems}
      readOnly={readOnly}
      controls={controls}
      onChanged={onChanged}
    />
  )
  if (!ordered.some((item) => item.topic !== null)) {
    return <KindGroups items={ordered} renderItem={renderItem} />
  }
  const renderTopicActions = (topic: string | null): ReactNode => {
    if (topic === null || !projectTopics.has(topic)) return null
    // A rename moves only the project's notes: the office's notes in this folder keep the name.
    const holdsOfficeNotes = items.some((item) => item.scope === 'organization' && item.topic === topic)
    return (
      <ProjectTopicActions
        projectId={projectId}
        topic={topic}
        mergeTargets={openTopicNames}
        holdsOfficeNotes={holdsOfficeNotes}
        onChanged={onChanged}
      />
    )
  }
  return (
    <TopicFolders
      items={ordered}
      topics={topics}
      renderItem={renderItem}
      renderTopicActions={readOnly ? undefined : renderTopicActions}
    />
  )
}

/** The notes by kind, under the kind's heading, as the shelf listed them before topics. */
function KindGroups({
  items,
  renderItem,
}: {
  items: MemoryItem[]
  renderItem: (item: MemoryItem) => ReactNode
}): JSX.Element {
  const kindLabels = useMemoryKindLabels()
  const groups = PROJECT_MEMORY_KINDS.map((kind) => ({
    kind,
    items: items.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0)
  return (
    <ItemList data-testid="kind-groups">
      {groups.map((group) => (
        <Fragment key={group.kind}>
          <div className="bg-muted px-5 py-2">
            <SectionLabel as="h3">{kindLabels.group(group.kind)}</SectionLabel>
          </div>
          {group.items.map((item) => (
            <Fragment key={item.id}>{renderItem(item)}</Fragment>
          ))}
        </Fragment>
      ))}
    </ItemList>
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
