'use client'

import type { JSX, ReactNode } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowUpRight, CheckCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CountPill } from '@/components/ui/count-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import type { InboxItemView, InboxListFilter } from '@/lib/inbox/types'
import { cn } from '@/lib/utils'
import { useInboxList } from '../hooks/use-inbox'
import { ARCHIVE_UNDO_MS, useUndoableArchive } from '../hooks/use-undoable-archive'
import { newestFirstOverdueOnTop } from '../lib/inbox-entry-order'
import { isOpenRequest } from '../lib/inbox-queue'
import { InboxEntry } from './InboxEntry'
import { InboxItemRow } from './InboxItemRow'
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
}

export function InboxWorkspace({ viewerId = null, offer = null }: InboxWorkspaceProps): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const router = useRouter()
  const pathname = usePathname() ?? '/app/inbox'
  const params = useSearchParams()
  const tab = inboxTabOf(params?.get('tab'))
  const pickedId = params?.get('item') ?? null
  const list = useInboxList(true, TAB_FILTER[tab])
  const archiveLater = useUndoableArchive(list.archive)

  const entries = useMemo(() => {
    const shown = list.items.filter((item) => !archiveLater.pendingIds.has(item.id) && (tab !== 'news' || !isOpenRequest(item)))
    return newestFirstOverdueOnTop(shown)
  }, [list.items, archiveLater.pendingIds, tab])
  const picked = entries.find((item) => item.id === pickedId) ?? entries[0] ?? null

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

  const archive = useCallback(
    (itemId: string): void => {
      archiveLater.request(itemId)
      toast(t('inbox.archived'), { duration: ARCHIVE_UNDO_MS, action: { label: t('inbox.undo'), onClick: () => archiveLater.undo(itemId) } })
    },
    [archiveLater, t]
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
      else if (key === 'u') void (picked.read ? list.markUnread([picked.id]) : list.markRead([picked.id]))
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entries, pickedId, picked, pick, archive, list, router])

  const count = (key: InboxTab): number => (key === 'waiting' ? list.counts.requests : key === 'news' ? list.counts.unread : 0)
  const hasUnread = entries.some((item) => !item.read)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="inbox-workspace">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <ToggleGroup type="single" segmented variant="inverted" size="sm" value={tab} onValueChange={(value) => value && go({ tab: inboxTabOf(value) })} aria-label={t('inbox.filters.ariaLabel')}>
          {INBOX_TABS.map((key) => (
            <ToggleGroupItem key={key} value={key} data-testid={`inbox-tab-${key}`}>
              {t(TAB_LABEL[key])}
              {count(key) > 0 && <CountPill count={count(key)} className={cn(tab === key && 'bg-background/20 text-current')} />}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {tab !== 'archived' && (
          <Button variant="ghost" size="sm" className="text-muted-foreground shrink-0" disabled={!hasUnread || list.mutating} onClick={() => void list.markAllRead()} data-testid="inbox-mark-all-read">
            <CheckCheck aria-hidden />
            {t('inbox.markAllReadShort')}
          </Button>
        )}
      </div>

      {offer}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="scroll-fade-bottom min-h-0 overflow-y-auto pb-6" data-testid="inbox-entries">
          {list.loading ? (
            <InboxQueueSkeleton />
          ) : list.error ? (
            <EmptyState title={t('inbox.errors.loadFailed')} />
          ) : entries.length === 0 ? (
            <EmptyState title={t(EMPTY[tab][0])} description={t(EMPTY[tab][1])} />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {entries.map((item) => (
                <li key={item.id}>
                  <InboxEntry item={item} current={item.id === picked?.id} onPick={pick} />
                </li>
              ))}
              {list.hasMore && (
                <li className="pt-2">
                  <Button variant="ghost" size="sm" disabled={list.loadingMore} onClick={list.loadMore}>
                    {list.loadingMore ? t('inbox.loadingMore') : t('inbox.loadMore')}
                  </Button>
                </li>
              )}
            </ul>
          )}
        </div>

        <section className={cn('border-base bg-card min-h-0 overflow-y-auto rounded-surface border p-4', !picked && 'max-lg:hidden')} aria-label={t('inbox.page.opened')} data-testid="inbox-opened">
          {picked ? (
            <div className="flex flex-col gap-3">
              <ul>
                <InboxItemRow
                  item={picked}
                  viewerId={viewerId}
                  onArchive={archive}
                  onUnarchive={(itemId) => void list.unarchive(itemId)}
                  onMarkRead={(itemId) => void list.markRead([itemId])}
                  onMarkUnread={(itemId) => void list.markUnread([itemId])}
                />
              </ul>
              {picked.href && (
                <Button asChild variant="secondary" size="sm" className="self-start">
                  <Link href={picked.href} data-testid="inbox-opened-go">
                    <ArrowUpRight aria-hidden />
                    {t('inbox.page.go')}
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground flex h-full items-center justify-center text-center text-sm">{t('inbox.page.pick')}</p>
          )}
        </section>
      </div>
    </div>
  )
}
