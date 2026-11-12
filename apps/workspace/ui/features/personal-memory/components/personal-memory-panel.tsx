'use client'

/**
 * „Mein Gedächtnis“: the notes the agent keeps about one person (ADR-0180),
 * for that person to read, add to, correct, pin and remove. It opens with the
 * one sentence the store exists to make true: nobody else reads these.
 *
 * The list is the project memory panel's, from the same parts
 * (`memory-note-parts.tsx`), without what a personal note does not have:
 * no verification, no confidence, no scope. Order is the server's (pinned
 * first, then newest) and is kept after a local change by the same rule.
 * The notes are shown as folders by topic (`TopicFolders`); the topics are
 * counted from the notes this list holds, which is the whole shelf.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brain, Lock, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiRequestError } from '@/adapters/api/api-error'
import {
  addPersonalMemoryNote,
  clearPersonalMemory,
  listPersonalMemory,
  removePersonalMemoryNote,
  updatePersonalMemoryNote,
  type PersonalMemoryNote,
} from '@/adapters/api/personal-memory-client'
import {
  MemoryListSkeleton,
  MemoryNoteAction,
  MemoryNoteActions,
  MemoryNoteEditor,
  MemoryNoteItem,
  MemoryNoteText,
} from '@/components/memory/memory-note-parts'
import { TopicFolders } from '@/components/memory/topic-folders'
import { TopicPicker } from '@/components/memory/topic-picker'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { FactLine } from '@/components/ui/fact-line'
import { Field, FieldLabel } from '@/components/ui/field'
import { ItemContent } from '@/components/ui/item'
import { LoadError } from '@/components/ui/load-error'
import { NoteMeta } from '@/components/ui/note-list'
import { RaisedCard, RaisedCardBody } from '@/components/ui/raised-card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import { memoryTopicsCopy } from '@/i18n/namespaces/memory-topics'
import { personalMemoryCopy } from '@/i18n/namespaces/personal-memory'
import { useMemoryKindLabels } from '@/components/memory/memory-kinds'
import { collectPages } from '@/lib/api/offset-page'
import { summarizeTopics } from '@/lib/memory-topics/topic'
import { noteRefusalKind, type NoteRefusalKind } from '@/lib/knowledge/note-refusal'
import {
  PERSONAL_MEMORY_KINDS,
  PERSONAL_MEMORY_MAX_CONTENT_CHARS,
  type PersonalMemoryKind,
} from '@/lib/personal-memory/vocabulary'
import { PersonalNoteTopicMove, PersonalTopicActions } from './personal-topic-actions'

/** The server's order: pinned first, then the most recently changed. */
function inServerOrder(notes: PersonalMemoryNote[]): PersonalMemoryNote[] {
  return [...notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)
  )
}

const isConflict = (error: unknown): boolean => error instanceof ApiRequestError && error.status === 409

/** What a note held that the server refused it for (`details.kind`), or null for any other failure. */
const refusedKind = (error: unknown): NoteRefusalKind | null =>
  error instanceof ApiRequestError && error.status === 400 ? noteRefusalKind(error.details) : null

export function PersonalMemoryPanel(): JSX.Element {
  const t = useTranslations(personalMemoryCopy)
  const topicCopy = useTranslations(memoryTopicsCopy)
  const kindLabels = useMemoryKindLabels()
  const { locale } = useLocale()
  const [notes, setNotes] = useState<PersonalMemoryNote[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  /** The note a request is out for: its actions wait. */
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  /** Why the open editor's last save was refused; it stays open with the text. */
  const [editError, setEditError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  /** The confirmation for removing every note is open; `clearing` while its request is out. */
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  const [adding, setAdding] = useState(false)
  const [addKind, setAddKind] = useState<PersonalMemoryKind>('preference')
  const [addContent, setAddContent] = useState('')
  const [addTopic, setAddTopic] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)

  const load = useCallback(async (signal: { cancelled: boolean }): Promise<void> => {
    setLoadFailed(false)
    try {
      const all = await collectPages<PersonalMemoryNote>((cursor) => listPersonalMemory({ limit: 200, cursor }))
      if (!signal.cancelled) setNotes(all)
    } catch {
      if (!signal.cancelled) setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    const signal = { cancelled: false }
    void load(signal)
    return () => {
      signal.cancelled = true
    }
  }, [load])

  /** The shelf's topics, most notes first, and their names: every note the person holds is in `notes`. */
  const topics = useMemo(() => summarizeTopics(notes ?? []), [notes])
  const topicNames = useMemo(() => topics.map((topic) => topic.name), [topics])
  /** Read the list again after a topic changed: a renamed, merged or removed topic moves notes out of their folder. */
  const reload = useCallback((): Promise<void> => load({ cancelled: false }), [load])

  /** Put a note the server answered into the list, in the list's order; a note already there is replaced. */
  /** Why a save failed, in the person's language: the refused kind when the server named one, else the generic text. */
  const saveFailure = (error: unknown): string => {
    const kind = refusedKind(error)
    return kind ? t(`refused.${kind}`) : t('errors.saveFailed')
  }

  const keep = (note: PersonalMemoryNote): void => {
    setNotes((previous) => inServerOrder([note, ...(previous ?? []).filter((existing) => existing.id !== note.id)]))
  }

  const closeAdd = (): void => {
    setAdding(false)
    setAddContent('')
    setAddTopic(null)
  }

  const submitAdd = async (): Promise<void> => {
    const content = addContent.trim()
    if (!content) return
    setAddBusy(true)
    try {
      const { item, created } = await addPersonalMemoryNote({ kind: addKind, content, topic: addTopic })
      keep(item)
      closeAdd()
      // A text one of the person's notes already says is that note, marked current: nothing was added.
      toast.success(t(created ? 'added' : 'alreadyKept'))
    } catch (error) {
      toast.error(saveFailure(error))
    } finally {
      setAddBusy(false)
    }
  }

  const togglePin = async (note: PersonalMemoryNote): Promise<void> => {
    setBusyId(note.id)
    try {
      const { item } = await updatePersonalMemoryNote(note.id, { pinned: !note.pinned })
      keep(item)
      toast.success(t(item.pinned ? 'pinnedNote' : 'unpinnedNote'))
    } catch {
      toast.error(t('errors.saveFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const startEdit = (note: PersonalMemoryNote): void => {
    setEditingId(note.id)
    setEditDraft(note.content)
    setEditError(null)
  }

  const submitEdit = async (note: PersonalMemoryNote): Promise<void> => {
    const content = editDraft.trim()
    if (!content) return
    setBusyId(note.id)
    setEditError(null)
    try {
      const { item } = await updatePersonalMemoryNote(note.id, { content })
      keep(item)
      setEditingId(null)
      toast.success(t('updated'))
    } catch (error) {
      // The editor stays open with what was typed: the person decides what to do with it.
      setEditError(isConflict(error) ? t('errors.conflict') : saveFailure(error))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (noteId: string): Promise<void> => {
    setBusyId(noteId)
    try {
      await removePersonalMemoryNote(noteId)
      setNotes((previous) => (previous ? previous.filter((note) => note.id !== noteId) : previous))
      toast.success(t('removed'))
    } catch {
      toast.error(t('errors.removeFailed'))
    } finally {
      setBusyId(null)
      setRemovingId(null)
    }
  }

  const clear = async (): Promise<void> => {
    setClearing(true)
    try {
      // The server removes every note the person holds, also one kept since this
      // list was read, so the count that is said afterwards is the server's.
      const { removed } = await clearPersonalMemory()
      setNotes([])
      setEditingId(null)
      toast.success(t('removedAll', { count: removed }))
    } catch {
      toast.error(t('errors.removeAllFailed'))
    } finally {
      setClearing(false)
      setConfirmingClear(false)
    }
  }

  /** One note's row: its text or its editor, and its actions. */
  const renderNote = (note: PersonalMemoryNote): JSX.Element => {
    const busy = busyId === note.id
    const isEditing = editingId === note.id
    return (
      <MemoryNoteItem data-testid="personal-memory-note">
        <ItemContent>
          {isEditing ? (
            <MemoryNoteEditor
              id={`personal-memory-edit-${note.id}`}
              label={t('editLabel')}
              value={editDraft}
              onChange={(value) => {
                setEditDraft(value)
                setEditError(null)
              }}
              onSave={() => void submitEdit(note)}
              onCancel={() => setEditingId(null)}
              busy={busy}
              saveLabel={t('save')}
              cancelLabel={t('cancel')}
              error={editError}
              maxLength={PERSONAL_MEMORY_MAX_CONTENT_CHARS}
            />
          ) : (
            <>
              <MemoryNoteText pinned={note.pinned} pinnedLabel={t('pinned')}>
                {note.content}
              </MemoryNoteText>
              <div className="text-muted-foreground mt-1 text-xs">
                <NoteMeta
                  parts={[
                    kindLabels.kind(note.kind),
                    t(`provenance.${note.provenanceType}`),
                    <TimeAgo key="when" date={note.updatedAt} locale={locale} short />,
                  ]}
                />
              </div>
            </>
          )}
        </ItemContent>

        {!isEditing && (
          <MemoryNoteActions>
            <PersonalNoteTopicMove item={note} topics={topicNames} onChanged={reload} />
            <MemoryNoteAction
              icon={note.pinned ? PinOff : Pin}
              label={note.pinned ? t('unpin') : t('pin')}
              title={note.pinned ? t('unpinTitle') : t('pinTitle')}
              onClick={() => void togglePin(note)}
              disabled={busy}
            />
            <MemoryNoteAction
              icon={Pencil}
              label={t('edit')}
              title={t('edit')}
              onClick={() => startEdit(note)}
              disabled={busy}
            />
            <MemoryNoteAction
              icon={Trash2}
              label={t('remove')}
              title={t('removeTitle')}
              onClick={() => setRemovingId(note.id)}
              disabled={busy}
              destructive
            />
          </MemoryNoteActions>
        )}
      </MemoryNoteItem>
    )
  }

  /** A folder's actions: rename, merge, remove for a topic; none for the notes without one. */
  const renderTopicActions = (topic: string | null): JSX.Element | null => {
    if (topic === null) return null
    const count = topics.find((entry) => entry.name === topic)?.count ?? 0
    return <PersonalTopicActions topic={topic} count={count} onChanged={reload} />
  }

  return (
    <section className="min-w-0 space-y-4" data-testid="personal-memory-panel">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <FactLine icon={Lock} tone="default" className="min-w-0 flex-1 basis-56 text-sm" testId="personal-memory-audience">
          {t('audience')}
        </FactLine>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setAdding(true)}
          className={adding ? 'pointer-events-none invisible' : undefined}
          tabIndex={adding ? -1 : undefined}
          aria-hidden={adding || undefined}
        >
          <Plus className="size-4" aria-hidden />
          {t('add')}
        </Button>
      </div>

      {adding && (
        <RaisedCard className="animate-in fade-in-0 duration-base ease-out motion-reduce:animate-none">
          <RaisedCardBody className="space-y-3 p-4">
            <Field>
              <FieldLabel htmlFor="personal-memory-add-kind">{t('kindLabel')}</FieldLabel>
              <Select value={addKind} onValueChange={(value) => setAddKind(value as PersonalMemoryKind)}>
                <SelectTrigger id="personal-memory-add-kind" className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERSONAL_MEMORY_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {kindLabels.kind(kind)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="personal-memory-add-content">{t('contentLabel')}</FieldLabel>
              <Textarea
                id="personal-memory-add-content"
                value={addContent}
                onChange={(event) => setAddContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    closeAdd()
                  }
                }}
                placeholder={t('addPlaceholder')}
                maxLength={PERSONAL_MEMORY_MAX_CONTENT_CHARS}
                rows={2}
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="personal-memory-add-topic">{topicCopy('filterLabel')}</FieldLabel>
              <TopicPicker
                id="personal-memory-add-topic"
                topics={topicNames}
                value={addTopic}
                onChange={setAddTopic}
                disabled={addBusy}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={closeAdd} disabled={addBusy}>
                {t('cancel')}
              </Button>
              <Button size="sm" onClick={() => void submitAdd()} disabled={addBusy || addContent.trim().length === 0}>
                {t('addSubmit')}
              </Button>
            </div>
          </RaisedCardBody>
        </RaisedCard>
      )}

      {loadFailed && (
        <LoadError
          title={t('errors.loadTitle')}
          description={t('errors.loadDescription')}
          onRetry={() => load({ cancelled: false })}
        />
      )}

      {!loadFailed && notes === null && <MemoryListSkeleton />}

      {!loadFailed && notes !== null && notes.length === 0 && (
        <EmptyState icon={Brain} title={t('emptyTitle')} description={t('emptyDescription')} />
      )}

      {!loadFailed && notes !== null && notes.length > 0 && (
        <TopicFolders items={notes} topics={topics} renderItem={renderNote} renderTopicActions={renderTopicActions} />
      )}

      {/* Under the list it empties, and quiet: tonal like „Notiz hinzufügen“, its
          glyph in red. The confirmation is where the red press is, with the
          number of notes and that it cannot be undone. */}
      {!loadFailed && notes !== null && notes.length > 0 && (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => setConfirmingClear(true)} disabled={clearing}>
            <Trash2 className="text-destructive size-4" aria-hidden />
            {t('removeAll')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={removingId !== null}
        onOpenChange={(open) => {
          if (!open) setRemovingId(null)
        }}
        tone="destructive"
        title={t('removeConfirmTitle')}
        description={t('removeConfirmDescription')}
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        pending={removingId !== null && busyId === removingId}
        onConfirm={() => {
          if (removingId) return remove(removingId)
        }}
      />

      <ConfirmDialog
        open={confirmingClear}
        onOpenChange={(open) => {
          if (!open) setConfirmingClear(false)
        }}
        tone="destructive"
        title={t('removeAllConfirmTitle')}
        description={t('removeAllConfirmDescription', { count: notes?.length ?? 0 })}
        confirmLabel={t('removeAll')}
        cancelLabel={t('cancel')}
        pending={clearing}
        onConfirm={clear}
      />
    </section>
  )
}
