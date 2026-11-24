'use client'

import type { JSX, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Archive } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PAGE_TITLE_CLASS } from '@/components/ui/page-header'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import type { InboxItemView, InboxListFilter } from '@/lib/inbox/types'
import { cn } from '@/lib/utils'
import { useInboxList } from '../hooks/use-inbox'
import { markOf } from '../hooks/use-inbox-mark'
import { MARK_CLIENT, type InboxMarkClient } from '../hooks/use-mark-answer'
import { ARCHIVE_UNDO_MS, useUndoableArchive } from '../hooks/use-undoable-archive'
import { newestFirstOverdueOnTop, nextAfterLeaving, sameDocumentAs } from '../lib/inbox-entry-order'
import { isOpenRequest } from '../lib/inbox-queue'
import { InboxEntry } from './InboxEntry'
import { InboxOpened, isSettledByAnswer } from './InboxOpened'
import { InboxQueueSkeleton } from './InboxSkeleton'

export const INBOX_TABS = ['waiting', 'news', 'archived'] as const
export type InboxTab = (typeof INBOX_TABS)[number]

const TAB_FILTER: Record<InboxTab, InboxListFilter> = { waiting: 'requests', news: 'all', archived: 'archived' }
const TAB_LABEL = { waiting: 'inbox.queue.waiting', news: 'inbox.queue.news', archived: 'inbox.filters.archived' } as const
const EMPTY = {
  waiting: ['inbox.empty.needsMeTitle', 'inbox.empty.needsMeDescription'],
  news: ['inbox.empty.allTitle', 'inbox.empty.allDescription'],
  archived: ['inbox.empty.archivedTitle', 'inbox.empty.archivedDescription'],
} as const

export function inboxTabOf(value: string | null | undefined): InboxTab {
  return INBOX_TABS.find((tab) => tab === value) ?? 'waiting'
}

export interface InboxWorkspaceProps {
  viewerId?: string | null
  offer?: ReactNode
  title?: string
  back?: ReactNode
  markClient?: InboxMarkClient
}

export function InboxWorkspace({ viewerId = null, offer = null, title, back = null, markClient = MARK_CLIENT }: InboxWorkspaceProps): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const router = useRouter()
  const pathname = usePathname() ?? '/app/inbox'
  const params = useSearchParams()
  const tab = inboxTabOf(params?.get('tab'))
  const pickedId = params?.get('item') ?? null
  const list = useInboxList(true, TAB_FILTER[tab])
  const archiveLater = useUndoableArchive(list.archive)
  const known = useRef(new Map<string, InboxItemView>())
  known.current = new Map(list.items.map((item) => [item.id, item]))
  const { refresh } = list
  const resolveLater = useUndoableArchive(
    useCallback(
      async (itemId: string): Promise<void> => {
        const target = known.current.get(itemId)
        const mark = target ? markOf(target) : null
        if (!mark) return
        try {
          await markClient.update(mark.documentId, mark.annotationId, { status: 'resolved', expectedStatus: 'open' })
        } catch {
          toast.error(t('inbox.mark.failed'))
        }
        refresh()
      },
      [markClient, refresh, t]
    )
  )
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set())

  const entries = useMemo(() => {
    const hidden = (item: InboxItemView): boolean =>
      archiveLater.pendingIds.has(item.id) || resolveLater.pendingIds.has(item.id) || (tab === 'waiting' && answered.has(item.id))
    const shown = list.items.filter((item) => !hidden(item) && (tab !== 'news' || !isOpenRequest(item)))
    return newestFirstOverdueOnTop(shown)
  }, [list.items, archiveLater.pendingIds, resolveLater.pendingIds, answered, tab])
  const picked = entries.find((item) => item.id === pickedId) ?? entries[0] ?? null
  const sameDocument = useMemo(() => {
    const rest = picked ? sameDocumentAs(entries, picked) : []
    return rest.length > 0 ? { next: rest[0], remaining: rest.length } : null
  }, [entries, picked])

  const go = useCallback(
    (next: { tab?: InboxTab; item?: string | null }): void => {
      const query = new URLSearchParams(params?.toString() ?? '')
      if (next.tab) {
        if (next.tab === 'waiting') query.delete('tab')
        else query.set('tab', next.tab)
        query.delete('item')
      }
      if (next.item !== undefined) {
        if (next.item) query.set('item', next.item)
        else query.delete('item')
      }
      const search = query.toString()
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false })
    },
    [params, pathname, router]
  )

  const pick = useCallback(
    (item: InboxItemView): void => {
      go({ item: item.id })
      if (!item.read) void list.markRead([item.id])
    },
    [go, list]
  )

  const leave = useCallback(
    (itemId: string): void => {
      if (picked?.id !== itemId) return
      const next = nextAfterLeaving(entries, itemId)
      if (next) pick(next)
      else go({ item: null })
    },
    [entries, picked, pick, go]
  )

  const archive = useCallback(
    (itemId: string): void => {
      leave(itemId)
      archiveLater.request(itemId)
      toast(t('inbox.archived'), { duration: ARCHIVE_UNDO_MS, action: { label: t('inbox.undo'), onClick: () => archiveLater.undo(itemId) } })
    },
    [archiveLater, leave, t]
  )

  const resolve = useCallback(
    (item: InboxItemView): void => {
      leave(item.id)
      resolveLater.request(item.id)
      toast(t('inbox.mark.resolved'), { duration: ARCHIVE_UNDO_MS, action: { label: t('inbox.undo'), onClick: () => resolveLater.undo(item.id) } })
    },
    [leave, resolveLater, t]
  )

  const answer = useCallback(
    (item: InboxItemView): void => {
      if (!isSettledByAnswer(item)) return
      leave(item.id)
      setAnswered((current) => new Set(current).add(item.id))
      refresh()
    },
    [leave, refresh]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
      const key = event.key.toLowerCase()
      const at = entries.findIndex((item) => item.id === picked?.id)
      if (key === 'j' || key === 'k') {
        const next = entries[at < 0 ? 0 : Math.min(entries.length - 1, Math.max(0, at + (key === 'j' ? 1 : -1)))]
        if (next) pick(next)
      } else if (!picked) return
      else if (key === 'enter' && picked.href && !target?.closest('button, a')) router.push(picked.href)
      else if (key === 'e' && !picked.archived) archive(picked.id)
      else if (key === 'r') document.querySelector<HTMLTextAreaElement>('[data-testid="inbox-opened-reply"]')?.focus()
      else if (key === 'u') void (picked.read ? list.markUnread([picked.id]) : list.markRead([picked.id]))
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entries, pickedId, picked, pick, archive, list, router])

  const count = (key: InboxTab): number => (key === 'waiting' ? list.counts.requests : key === 'news' ? list.counts.unread : 0)
  const hasAnything = entries.length > 0 || list.pending > 0 || list.counts.unread > 0
  const archiveAll = (): void => {
    go({ item: null })
    void list.archiveAll().then((archivedAt) => {
      if (!archivedAt) return
      toast(t('inbox.archivedAll'), {
        duration: ARCHIVE_UNDO_MS,
        action: { label: t('inbox.undo'), onClick: () => void list.unarchiveAll(archivedAt) },
      })
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="inbox-workspace">
      <div className="border-base flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          {back}
          {title && <h1 className={PAGE_TITLE_CLASS}>{title}</h1>}
        </div>
        <div className="flex min-h-8 items-center gap-2">
          <ToggleGroup type="single" segmented size="sm" value={tab} onValueChange={(value) => value && go({ tab: inboxTabOf(value) })} aria-label={t('inbox.filters.ariaLabel')}>
            {INBOX_TABS.map((key) => (
              <ToggleGroupItem key={key} value={key} data-testid={`inbox-tab-${key}`}>
                {t(TAB_LABEL[key])}
                {count(key) > 0 && <span className="text-muted-foreground tabular-nums" data-testid={`inbox-tab-count-${key}`}>{count(key)}</span>}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            variant="ghost"
            size="sm"
            className={cn('text-muted-foreground shrink-0', tab === 'archived' && 'invisible')}
            aria-hidden={tab === 'archived' || undefined}
            tabIndex={tab === 'archived' ? -1 : undefined}
            disabled={tab === 'archived' || !hasAnything || list.mutating}
            onClick={archiveAll}
            data-testid="inbox-archive-all"
          >
            <Archive aria-hidden />
            {t('inbox.archiveAll')}
          </Button>
        </div>
      </div>

      {offer}

      {!list.loading && !list.error && entries.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center pb-16" data-testid="inbox-entries">
          <EmptyState title={t(EMPTY[tab][0])} description={t(EMPTY[tab][1])} className="border-0 bg-transparent" />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]">
          <div className="scroll-fade-bottom min-h-0 overflow-y-auto pb-6" data-testid="inbox-entries">
            {list.loading ? (
              <InboxQueueSkeleton />
            ) : list.error ? (
              <EmptyState title={t('inbox.errors.loadFailed')} />
            ) : (
              <ul className="flex flex-col">
                {entries.map((item) => (
                  <li key={item.id}>
                    <InboxEntry item={item} current={item.id === picked?.id} onPick={pick} />
                  </li>
                ))}
                {list.hasMore && (
                  <li className="px-4 pt-3">
                    <Button variant="ghost" size="sm" disabled={list.loadingMore} onClick={list.loadMore}>
                      {list.loadingMore ? t('inbox.loadingMore') : t('inbox.loadMore')}
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </div>

          <section className={cn('border-base min-h-0 p-6 lg:border-l', !picked && 'max-lg:hidden')} aria-label={t('inbox.page.opened')} data-testid="inbox-opened">
            {picked && (
              <InboxOpened
                key={picked.id}
                item={picked}
                viewerId={viewerId}
                sameDocument={sameDocument}
                markClient={markClient}
                onArchive={archive}
                onUnarchive={(itemId) => void list.unarchive(itemId)}
                onResolve={resolve}
                onAnswered={answer}
                onPick={pick}
              />
            )}
          </section>
        </div>
      )}
    </div>
  )
}
