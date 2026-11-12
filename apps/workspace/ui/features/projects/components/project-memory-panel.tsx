'use client'

import { collectPages } from '@/lib/api/offset-page'
import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Brain, Plus, Users } from 'lucide-react'
import { MemoryListSkeleton } from '@/components/memory/memory-note-parts'
import { TopicPicker } from '@/components/memory/topic-picker'
import type { MemoryTopicCount } from '@/lib/memory-topics/topic'
import {
  ProjectMemoryTopicGroups,
  pickableTopicNames,
  type MemoryItem,
  type ProjectMemoryNoteControls,
} from './project-memory-topic-groups'
import { PROJECT_MEMORY_KINDS, type ProjectMemoryKind } from '@/lib/db/schema/project-memory'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { FactLine } from '@/components/ui/fact-line'
import { Field, FieldLabel } from '@/components/ui/field'
import { LoadError } from '@/components/ui/load-error'
import { RaisedCard, RaisedCardBody } from '@/components/ui/raised-card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useTranslations } from '@/i18n'
import type { Translator } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { memoryTopicsCopy } from '@/i18n/namespaces/memory-topics'
import { personalMemoryCopy } from '@/i18n/namespaces/personal-memory'
import { noteRefusalKind, type NoteRefusalKind } from '@/lib/knowledge/note-refusal'
import { useMemoryKindLabels } from '@/components/memory/memory-kinds'

/**
 * Project Memory panel — "What Piloti knows about this project".
 * See docs/architecture/project-memory-design.md §7: capture is silent, this
 * panel is the human backstop (view / add / edit / confirm / pin / dismiss).
 */

/** One page of the shelf's list: its notes, the cursor on, and the shelf's topics. */
interface MemoryPage {
  items: MemoryItem[]
  nextCursor: string | null
  topics?: MemoryTopicCount[]
}

interface ProjectMemoryPanelProps {
  projectId: string
  /**
   * A list without the controls to add, confirm, pin, edit or remove: for a
   * reader without `project:memory:write`, whose every click would answer 404,
   * and for a closed project, whose memory is read-only (ADR-0090).
   */
  readOnly?: boolean
}

/**
 * `refused` says why a note was refused when the server named its kind
 * (`details.kind`, `bff/knowledge/note-refusal.ts`); any other failure keeps
 * the generic text.
 */
async function requestJson<T>(
  url: string,
  init?: RequestInit,
  t?: Translator,
  refused?: (kind: NoteRefusalKind) => string
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  if (!res.ok) {
    const body: unknown = res.status === 400 && refused ? await res.json().catch(() => null) : null
    const kind = noteRefusalKind((body as { details?: unknown } | null)?.details)
    if (kind && refused) throw new Error(refused(kind))
    throw new Error(
      t
        ? t('memory.errors.requestFailed', { status: res.status })
        : `Request failed (${res.status})`
    )
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function ProjectMemoryPanel({
  projectId,
  readOnly = false,
}: ProjectMemoryPanelProps): JSX.Element {
  const t = useTranslations(projectsCopy)
  const tNote = useTranslations(personalMemoryCopy)
  const tTopic = useTranslations(memoryTopicsCopy)
  const refused = (kind: NoteRefusalKind): string => tNote(`refused.${kind}`)
  const kindLabels = useMemoryKindLabels()
  const [items, setItems] = useState<MemoryItem[] | null>(null)
  const [topics, setTopics] = useState<MemoryTopicCount[]>([])
  const [error, setError] = useState<string | null>(null)
  /** Item currently being mutated — disables its actions to avoid double-fires. */
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  // Add form
  const [adding, setAdding] = useState(false)
  const [addKind, setAddKind] = useState<ProjectMemoryKind>('decision')
  const [addScope, setAddScope] = useState<'project' | 'organization'>('project')
  const [addContent, setAddContent] = useState('')
  const [addTopic, setAddTopic] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)

  const baseUrl = `/api/projects/${projectId}/memory`
  const orgUrl = '/api/organization/memory'

  /** Org-wide items are managed through the organization endpoint. */
  const itemUrl = (item: MemoryItem) =>
    item.scope === 'organization' ? `${orgUrl}/${item.id}` : `${baseUrl}/${item.id}`

  const load = useCallback(
    (signal: { cancelled: boolean }, { silent = false }: { silent?: boolean } = {}) => {
      // A silent refetch (focus/interval revalidation) must not flash the
      // skeleton or clear an existing error banner — it only swaps in fresh
      // items when they arrive. The initial load is non-silent.
      if (!silent) setError(null)
      // Every page carries the shelf's topics, counted over the whole shelf
      // rather than the page: the last page's are kept.
      let shelfTopics: MemoryTopicCount[] = []
      collectPages<MemoryItem>((cursor) =>
        requestJson<MemoryPage>(
          `${baseUrl}?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          undefined,
          t
        ).then((page) => {
          shelfTopics = page.topics ?? []
          return page
        })
      )
        .then((all) => {
          if (signal.cancelled) return
          setItems(all)
          setTopics(shelfTopics)
          if (silent) setError(null)
        })
        .catch((err: unknown) => {
          if (signal.cancelled || silent) return
          setError(err instanceof Error ? err.message : t('memory.errors.loadFailed'))
        })
    },
    [baseUrl, t]
  )

  // Initial load.
  useEffect(() => {
    const signal = { cancelled: false }
    load(signal)
    return () => {
      signal.cancelled = true
    }
  }, [load])

  // Pause silent revalidation while the user is actively mutating (adding,
  // editing, deleting, or a request is in flight) so a background refetch never
  // clobbers optimistic UI or an open editor.
  const interacting = adding || editingId !== null || busyId !== null || confirmingDeleteId !== null
  const interactingRef = useRef(interacting)
  interactingRef.current = interacting

  // Revalidate so memory captured elsewhere (the chat `remember` tool and the
  // async reflection stage both write out-of-band) shows up without a manual
  // reload: on window focus / tab re-visibility, and on a slow interval while
  // the panel is mounted. Silent — never flashes the skeleton.
  useEffect(() => {
    const signal = { cancelled: false }
    const revalidate = () => {
      if (interactingRef.current) return
      if (document.visibilityState === 'visible') load(signal, { silent: true })
    }
    window.addEventListener('focus', revalidate)
    document.addEventListener('visibilitychange', revalidate)
    const interval = window.setInterval(revalidate, 30_000)
    return () => {
      signal.cancelled = true
      window.removeEventListener('focus', revalidate)
      document.removeEventListener('visibilitychange', revalidate)
      window.clearInterval(interval)
    }
  }, [load])

  const replaceItem = (updated: MemoryItem) => {
    setItems((prev) => (prev ? prev.map((it) => (it.id === updated.id ? updated : it)) : prev))
  }

  const patchItem = async (target: MemoryItem, body: Record<string, unknown>) => {
    setBusyId(target.id)
    try {
      const { item } = await requestJson<{ item: MemoryItem }>(
        itemUrl(target),
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
        t,
        refused
      )
      replaceItem(item)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('memory.errors.updateFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const deleteItem = async (target: MemoryItem) => {
    setBusyId(target.id)
    try {
      await requestJson<undefined>(itemUrl(target), { method: 'DELETE' }, t)
      setItems((prev) => (prev ? prev.filter((it) => it.id !== target.id) : prev))
      toast.success(t('memory.deleted'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('memory.errors.deleteFailed'))
    } finally {
      setBusyId(null)
      setConfirmingDeleteId(null)
    }
  }

  const closeAdd = () => {
    setAdding(false)
    setAddContent('')
    setAddTopic(null)
  }

  const submitAdd = async () => {
    const content = addContent.trim()
    if (!content) return
    setAddBusy(true)
    try {
      const { item } = await requestJson<{ item: MemoryItem }>(
        addScope === 'organization' ? orgUrl : baseUrl,
        {
          method: 'POST',
          body: JSON.stringify({ kind: addKind, content, topic: addTopic }),
        },
        t,
        refused
      )
      setItems((prev) => (prev ? [item, ...prev] : [item]))
      closeAdd()
      toast.success(t('memory.added'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('memory.errors.addFailed'))
    } finally {
      setAddBusy(false)
    }
  }

  const startEdit = (item: MemoryItem) => {
    setEditingId(item.id)
    setEditDraft(item.content)
    setConfirmingDeleteId(null)
  }

  const submitEdit = async (target: MemoryItem) => {
    const content = editDraft.trim()
    if (!content) return
    await patchItem(target, { content })
    setEditingId(null)
    toast.success(t('memory.updated'))
  }

  const visible =
    items?.filter((it) => it.status !== 'superseded' && it.status !== 'dismissed') ?? []
  const reload = () => load({ cancelled: false })
  const noteControls: ProjectMemoryNoteControls = {
    busyId,
    editingId,
    editDraft,
    onEditDraftChange: setEditDraft,
    onStartEdit: startEdit,
    onCancelEdit: () => setEditingId(null),
    onSaveEdit: (item) => void submitEdit(item),
    onPatch: (item, body) => void patchItem(item, body),
    onAskRemove: (id) => setConfirmingDeleteId(id),
  }
  const confirmingDeleteItem = items?.find((it) => it.id === confirmingDeleteId) ?? null
  // A new note takes an open topic, as a move does: an office note only the office's topics.
  const addTopicNames = pickableTopicNames(
    visible,
    { scope: addScope, restricted: false },
    topics.map((entry) => entry.name)
  )

  return (
    // `min-w-0`: the panel sits in a grid cell on the settings page, and a grid
    // item's automatic minimum is its widest unbreakable line. A restricted
    // note's badge or a long path in a note's text was enough to push the whole
    // page 97px past a phone's edge.
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="text-foreground text-sm font-medium">{t('memory.heading')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('memory.description')}</p>
          <FactLine icon={Users} className="mt-1.5" testId="memory-audience">
            {t('memory.audience')}
          </FactLine>
        </div>
        {!readOnly && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAdding(true)}
            className={adding ? 'pointer-events-none invisible' : undefined}
            tabIndex={adding ? -1 : undefined}
            aria-hidden={adding || undefined}
          >
            <Plus className="size-4" aria-hidden />
            {t('memory.addMemory')}
          </Button>
        )}
      </div>

      {!readOnly && adding && (
        <RaisedCard className="animate-in fade-in-0 duration-base ease-out motion-reduce:animate-none">
          <RaisedCardBody className="space-y-3 p-4">
            <div className="flex flex-wrap items-start gap-3">
              <Field>
                <FieldLabel htmlFor="memory-add-kind">{t('memory.kindAria')}</FieldLabel>
                <Select
                  value={addKind}
                  onValueChange={(value) => setAddKind(value as ProjectMemoryKind)}
                >
                  <SelectTrigger id="memory-add-kind" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_MEMORY_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {kindLabels.kind(kind)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="memory-add-scope">{t('memory.scopeAria')}</FieldLabel>
                <Select
                  value={addScope}
                  onValueChange={(value) => setAddScope(value as 'project' | 'organization')}
                >
                  <SelectTrigger id="memory-add-scope" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project">{t('memory.scopeProject')}</SelectItem>
                    <SelectItem value="organization">{t('memory.scopeOrganization')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="memory-add-content">{t('memory.addMemory')}</FieldLabel>
              <Textarea
                id="memory-add-content"
                value={addContent}
                onChange={(event) => setAddContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    closeAdd()
                  }
                }}
                placeholder={t('memory.addPlaceholder')}
                rows={2}
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="memory-add-topic">{tTopic('filterLabel')}</FieldLabel>
              <TopicPicker
                id="memory-add-topic"
                topics={addTopicNames}
                value={addTopic}
                onChange={setAddTopic}
                disabled={addBusy}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={closeAdd}
                disabled={addBusy}
              >
                {t('memory.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={submitAdd}
                disabled={addBusy || addContent.trim().length === 0}
              >
                {t('memory.add')}
              </Button>
            </div>
          </RaisedCardBody>
        </RaisedCard>
      )}

      {error && (
        <LoadError
          title={t('memory.errors.title')}
          description={error}
          onRetry={() => {
            setItems(null)
            return load({ cancelled: false })
          }}
        />
      )}

      {!error && items === null && <MemoryListSkeleton />}

      {!error && items !== null && visible.length === 0 && (
        <EmptyState
          icon={Brain}
          title={t('memory.emptyTitle')}
          description={t('memory.emptyDescription')}
        />
      )}

      {!error && items !== null && visible.length > 0 && (
        <ProjectMemoryTopicGroups
          projectId={projectId}
          items={visible}
          allItems={items}
          topics={topics}
          readOnly={readOnly}
          controls={noteControls}
          onChanged={reload}
        />
      )}

      <ConfirmDialog
        open={confirmingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmingDeleteId(null)
        }}
        tone="destructive"
        title={t('memory.removeConfirm')}
        description={t('memory.removeTitle')}
        confirmLabel={t('memory.remove')}
        cancelLabel={t('memory.cancel')}
        pending={confirmingDeleteItem !== null && busyId === confirmingDeleteItem.id}
        onConfirm={() => {
          if (confirmingDeleteItem) return deleteItem(confirmingDeleteItem)
        }}
      />
    </section>
  )
}
