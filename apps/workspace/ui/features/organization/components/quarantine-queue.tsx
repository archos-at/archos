'use client'

/**
 * Organisation → Quarantäne: the files the content check held back (ADR-0086),
 * and the two things a reviewer can do with one.
 *
 * The server decides who sees what: an org admin gets the organization's
 * queue, a project admin their projects' part of it, everyone else an empty
 * list. So the page is open to every member and this list never re-derives a
 * permission. Each row says what the file is, where it was uploaded, when, and
 * which rule caught it on which pages, through the same `QuarantineFindings`
 * the Files preview shows. Detector samples arrive masked from the job.
 *
 * Rows can be picked and decided together, filtered by what held them
 * (`./quarantine-selection`): the server takes the selection as one request and
 * answers per file. Release sends the file to the models like any other
 * upload, so it asks first. Delete goes through the same decision route, which
 * deletes only a file that is still held and answers the uploader's request
 * for a review. A row leaves the list only once the server said yes.
 *
 * „Ansehen" opens the file where it is filed, in the project's Files view or
 * the Büroablage, on its preview, which opens at the first finding and offers
 * the same two decisions: a reviewer may open a held file there
 * (`getAccessibleDocument`), and should see it before deciding. A chat
 * attachment has no per-file view, so its row offers none.
 */

import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Eye, FileWarning, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ApiRequestError } from '@/adapters/api/api-error'
import { listProjects } from '@/adapters/api/projects-client'
import {
  decideQuarantinedDocuments,
  listQuarantineQueue,
  releaseQuarantinedDocument,
  type QuarantineQueueItem,
} from '@/adapters/api/upload-screening-client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemList,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { TimeAgo } from '@/components/ui/time-ago'
import { QuarantineFindings } from '@/features/documents/components/quarantine-findings'
import { documentHref } from '@/features/uploads/lib/upload-summary'
import { useLocale, useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { QUARANTINE_DECISION_LIMIT, type QuarantineDecisionOutcome } from '@/lib/upload-screening/decisions-wire'
import { findingsOfItem, type FindingFilter, QuarantineSelection } from './quarantine-selection'

type PendingAction =
  | { kind: 'release' | 'delete'; item: QuarantineQueueItem }
  | { kind: 'releaseMany' | 'deleteMany'; ids: string[] }

/** Outcomes that did what was asked, and what the toast then says. */
const DONE: ReadonlySet<QuarantineDecisionOutcome> = new Set(['allowed', 'deleted', 'rechecking'])
const DONE_TOAST = {
  allow: 'quarantine.releasedMany',
  delete: 'quarantine.deletedMany',
  recheck: 'quarantine.recheckingMany',
} as const

/** Outcomes after which a row is no longer in the queue: decided here, or by someone else first. */
const LEAVES_QUEUE: ReadonlySet<QuarantineDecisionOutcome> = new Set([
  'allowed',
  'deleted',
  'rechecking',
  'changed',
  'not_found',
])

/** Project names for the "where" line. Best-effort: a failed read shows "a project". */
function useProjectNames(): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    const controller = new AbortController()
    listProjects({ signal: controller.signal })
      .then((rows) => setNames(new Map(rows.map((row) => [row.id, row.name]))))
      .catch(() => undefined)
    return () => controller.abort()
  }, [])
  return names
}

export const QuarantineQueue: FC = () => {
  const t = useTranslations(organizationCopy)
  const tc = useTranslations(commonCopy)
  const [items, setItems] = useState<QuarantineQueueItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  // The item stays set while the dialog animates out, so its title does not blank.
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const ask = (action: PendingAction): void => {
    setPending(action)
    setDialogOpen(true)
  }
  const projectNames = useProjectNames()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = useState<FindingFilter>('all')

  const load = useCallback(async (signal?: AbortSignal) => {
    setFailed(false)
    try {
      const next = await listQuarantineQueue(signal)
      setItems(next)
      // Picks someone else decided meanwhile no longer count against the cap.
      setSelected((prev) => new Set(next.filter((item) => prev.has(item.id)).map((item) => item.id)))
    } catch {
      if (!signal?.aborted) setFailed(true)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const drop = (id: string): void => {
    setItems((prev) => prev?.filter((item) => item.id !== id) ?? null)
    setSelected((prev) => new Set([...prev].filter((selectedId) => selectedId !== id)))
  }

  const counts = useMemo(() => {
    const byFinding = new Map<FindingFilter, number>()
    for (const item of items ?? []) {
      for (const kind of findingsOfItem(item)) byFinding.set(kind, (byFinding.get(kind) ?? 0) + 1)
    }
    return byFinding
  }, [items])
  // A filter whose rows are all decided falls back to everything.
  const activeFilter = filter !== 'all' && (counts.get(filter) ?? 0) === 0 ? 'all' : filter
  const shown = useMemo(
    () => (items ?? []).filter((item) => activeFilter === 'all' || findingsOfItem(item).has(activeFilter)),
    [items, activeFilter]
  )
  const selectedShown = shown.filter((item) => selected.has(item.id)).map((item) => item.id)

  const toggle = (id: string, on: boolean): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (!on) next.delete(id)
      else if (next.size < QUARANTINE_DECISION_LIMIT) next.add(id)
      return next
    })
  const selectAll = (all: boolean): void =>
    setSelected(all ? new Set(shown.slice(0, QUARANTINE_DECISION_LIMIT).map((item) => item.id)) : new Set())

  const decideMany = async (decision: 'allow' | 'delete' | 'recheck', ids: string[]): Promise<void> => {
    let results: Awaited<ReturnType<typeof decideQuarantinedDocuments>>
    try {
      results = await decideQuarantinedDocuments(decision, ids)
    } catch {
      toast.error(t('quarantine.decideError'))
      return
    }
    const gone = new Set(results.filter((result) => LEAVES_QUEUE.has(result.outcome)).map((result) => result.id))
    const done = results.filter((result) => DONE.has(result.outcome)).length
    const stuck = results.length - gone.size
    setItems((prev) => prev?.filter((item) => !gone.has(item.id)) ?? null)
    setSelected(new Set(ids.filter((id) => !gone.has(id))))
    if (done > 0) toast.success(t(DONE_TOAST[decision], { count: done }))
    if (stuck > 0) toast.error(t('quarantine.someFailed', { count: stuck }))
    // Someone else decided some of them first: the rest of the list may be stale too.
    if (done + stuck < results.length) void load()
  }

  const release = async (item: QuarantineQueueItem): Promise<void> => {
    try {
      await releaseQuarantinedDocument(item.id)
      drop(item.id)
      toast.success(t('quarantine.released', { name: item.filename }))
    } catch (error) {
      if (error instanceof ApiRequestError && (error.status === 409 || error.status === 404)) {
        // Someone else released or deleted it first: the list was stale, not the action wrong.
        toast.error(t('quarantine.changed'))
        void load()
        return
      }
      toast.error(t('quarantine.releaseError'))
    }
  }

  // Through the decision route, as a selection's delete: it deletes only what
  // is still held, and answers the uploader's „Prüfung anfragen".
  const remove = async (item: QuarantineQueueItem): Promise<void> => {
    const outcome = await decideQuarantinedDocuments('delete', [item.id])
      .then((results) => results[0]?.outcome ?? 'failed')
      .catch(() => 'failed' as const)
    if (outcome === 'deleted') {
      drop(item.id)
      toast.success(t('quarantine.deleted', { name: item.filename }))
      return
    }
    // A chat attachment is not found for a reviewer who is not in that chat.
    const notInChat = item.scope === 'session' && outcome === 'not_found'
    toast.error(notInChat ? t('quarantine.deleteErrorSession') : outcome === 'changed' ? t('quarantine.changed') : t('quarantine.deleteError'))
    void load()
  }

  if (failed) {
    return (
      <EmptyState
        title={t('quarantine.loadError')}
        action={
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {tc('actions.retry')}
          </Button>
        }
      />
    )
  }
  if (!items) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label={tc('states.loading')}>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title={t('quarantine.empty')}
        description={t('quarantine.emptyHint')}
        data-testid="quarantine-empty"
      />
    )
  }

  return (
    <>
      <QuarantineSelection
        counts={counts}
        filter={activeFilter}
        onFilterChange={(next) => {
          // Picks never hide behind a filter: what is acted on is what is shown.
          setFilter(next)
          setSelected(new Set())
        }}
        shown={shown.length}
        selected={selectedShown.length}
        limit={QUARANTINE_DECISION_LIMIT}
        onSelectAll={selectAll}
        onClear={() => setSelected(new Set())}
        onRelease={() => ask({ kind: 'releaseMany', ids: selectedShown })}
        onDelete={() => ask({ kind: 'deleteMany', ids: selectedShown })}
        onRecheck={() => void decideMany('recheck', selectedShown)}
      />
      <ItemList as="ul" aria-label={t('quarantine.listLabel')} data-testid="quarantine-queue">
        {shown.map((item) => (
          <QuarantineRow
            key={item.id}
            item={item}
            projectName={item.projectId ? projectNames.get(item.projectId) : undefined}
            selected={selected.has(item.id)}
            onSelect={(on) => toggle(item.id, on)}
            onRelease={() => ask({ kind: 'release', item })}
            onDelete={() => ask({ kind: 'delete', item })}
          />
        ))}
      </ItemList>

      <ConfirmDialog
        open={dialogOpen && (pending?.kind === 'release' || pending?.kind === 'releaseMany')}
        onOpenChange={setDialogOpen}
        title={
          pending?.kind === 'releaseMany'
            ? t('quarantine.releaseManyTitle', { count: pending.ids.length })
            : t('quarantine.releaseTitle', { name: pending && 'item' in pending ? pending.item.filename : '' })
        }
        description={
          pending?.kind === 'releaseMany'
            ? t('quarantine.releaseManyDescription', { count: pending.ids.length })
            : t('quarantine.releaseDescription')
        }
        confirmLabel={t('quarantine.release')}
        cancelLabel={tc('actions.cancel')}
        tone="warning"
        icon={ShieldOff}
        confirmTestId="quarantine-release-confirm"
        onConfirm={async () => {
          if (pending?.kind === 'releaseMany') await decideMany('allow', pending.ids)
          else if (pending?.kind === 'release') await release(pending.item)
        }}
      />
      <ConfirmDialog
        open={dialogOpen && (pending?.kind === 'delete' || pending?.kind === 'deleteMany')}
        onOpenChange={setDialogOpen}
        title={
          pending?.kind === 'deleteMany'
            ? t('quarantine.deleteManyTitle', { count: pending.ids.length })
            : t('quarantine.deleteTitle', { name: pending && 'item' in pending ? pending.item.filename : '' })
        }
        description={
          pending?.kind === 'deleteMany'
            ? t('quarantine.deleteManyDescription', { count: pending.ids.length })
            : t('quarantine.deleteDescription')
        }
        confirmLabel={t('quarantine.delete')}
        cancelLabel={tc('actions.cancel')}
        tone="destructive"
        icon={Trash2}
        confirmTestId="quarantine-delete-confirm"
        onConfirm={async () => {
          if (pending?.kind === 'deleteMany') await decideMany('delete', pending.ids)
          else if (pending?.kind === 'delete') await remove(pending.item)
        }}
      />
    </>
  )
}

const QuarantineRow: FC<{
  item: QuarantineQueueItem
  projectName: string | undefined
  selected: boolean
  onSelect: (selected: boolean) => void
  onRelease: () => void
  onDelete: () => void
}> = ({ item, projectName, selected, onSelect, onRelease, onDelete }) => {
  const t = useTranslations(organizationCopy)
  const { locale } = useLocale()
  const hasReasons = (item.verdict?.reasons.length ?? 0) > 0

  const where =
    item.scope === 'office_shelf'
      ? t('quarantine.whereOfficeShelf')
      : item.scope === 'session'
        ? t('quarantine.whereSession')
        : projectName
          ? t('quarantine.whereProject', { name: projectName })
          : t('quarantine.whereProjectUnknown')
  const href = documentHref(item, item.id)

  return (
    <Item as="li" className="flex-wrap items-start hover:bg-transparent" data-testid={`quarantine-row-${item.id}`}>
      <Checkbox
        className="mt-0.5"
        checked={selected}
        onCheckedChange={(checked) => onSelect(checked === true)}
        aria-label={t('quarantine.selectRow', { name: item.filename })}
        data-testid={`quarantine-select-${item.id}`}
      />
      <ItemMedia>
        <FileWarning className="size-5 text-warning" aria-hidden />
      </ItemMedia>
      <ItemContent className="flex flex-col gap-1.5">
        <ItemTitle title={item.filename}>{item.filename}</ItemTitle>
        <ItemDescription>
          {where} · <TimeAgo date={item.quarantinedAt} locale={locale} />
        </ItemDescription>
        {/* The findings as the preview shows them, pages as text: „Ansehen"
            opens the document at the first one, where the pages are buttons.
            Also says when the content was only partly checked. */}
        {item.verdict && (
          <QuarantineFindings verdict={item.verdict} withoutSentence testId={`quarantine-findings-${item.id}`} />
        )}
        {!hasReasons && (
          // A sentence, not a label: it wraps instead of truncating on a phone.
          <ItemDescription className="whitespace-normal">
            {item.held === 'unscreened' ? t('quarantine.unscreened') : t('quarantine.noReason')}
          </ItemDescription>
        )}
      </ItemContent>
      <ItemActions className="w-full justify-end sm:w-auto">
        {href && (
          <Button variant="ghost" size="sm" asChild>
            <Link
              href={href}
              title={t('quarantine.openTitle', { name: item.filename })}
              data-testid={`quarantine-open-${item.id}`}
            >
              <Eye className="size-4" aria-hidden />
              {t('quarantine.open')}
            </Link>
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onRelease} data-testid={`quarantine-release-${item.id}`}>
          {t('quarantine.release')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} data-testid={`quarantine-delete-${item.id}`}>
          <Trash2 className="size-4" aria-hidden />
          {t('quarantine.delete')}
        </Button>
      </ItemActions>
    </Item>
  )
}
