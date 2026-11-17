'use client'

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { AlertCircle, Check } from 'lucide-react'
import { toast } from 'sonner'

import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { localCalendarDay } from '@/lib/format'
import { inboxClient, type InboxClient } from '@/lib/inbox/client'
import { isMarkAnchored, type InboxItemView } from '@/lib/inbox/types'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FadeIn, motion, springSnap, useMotionToken } from '@/components/motion'
import { LoadError } from '@/components/ui/load-error'
import { LoadMore } from '@/components/ui/load-more'
import { withReviewBack } from '@/features/documents/review-links'
import { useInboxList } from '../hooks/use-inbox'
import { ARCHIVE_UNDO_MS, useUndoableArchive } from '../hooks/use-undoable-archive'
import { isAtHref, isOpenRequest, newsOf, newsWithHeld, queueOrder, waitingGroups } from '../lib/inbox-queue'
import { isPlainClick } from '../lib/plain-click'
import { InboxQueueList } from './InboxQueueList'
import { InboxQueueSkeleton } from './InboxSkeleton'

export interface InboxQueueProps {
  enabled?: boolean
  returnHere?: boolean
  keyScope?: 'page' | 'self'
  client?: InboxClient
}

const QUEUE_KEYS = new Set(['j', 'k', 'e', 'u'])

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select, [role="textbox"], [role="menu"], [role="listbox"]') !== null
}

export function InboxQueue({ enabled = true, returnHere = true, keyScope = 'page', client = inboxClient }: InboxQueueProps): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const waiting = useInboxList(enabled, 'requests', client)
  const fresh = useInboxList(enabled, 'unread', client)

  const archiveOf = useCallback(
    (itemId: string) => (waiting.items.some((item) => item.id === itemId) ? waiting.archive(itemId) : fresh.archive(itemId)),
    [waiting, fresh],
  )
  const archiveLater = useUndoableArchive(archiveOf)

  const today = localCalendarDay()
  const groups = useMemo(
    () => waitingGroups(waiting.items.filter((item) => !archiveLater.pendingIds.has(item.id)), today),
    [waiting.items, archiveLater.pendingIds, today],
  )
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const here = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ''}`

  const [held, setHeld] = useState<{ item: InboxItemView; at: number; from: string | null } | null>(null)
  const atHeld = held !== null && held.item.href !== null && isAtHref(held.item.href, pathname, searchParams)
  if (held && atHeld && held.from !== null) setHeld({ ...held, from: null })
  else if (held && !atHeld && held.from !== here) setHeld(null)

  const news = useMemo(
    () => newsWithHeld(newsOf(fresh.items), held).filter((item) => !archiveLater.pendingIds.has(item.id)),
    [fresh.items, held, archiveLater.pendingIds],
  )
  const order = useMemo(() => queueOrder(groups, news), [groups, news])
  const hrefOf = useCallback(
    (item: InboxItemView) => (item.href && returnHere && isMarkAnchored(item.type) ? withReviewBack(item.href, here) : item.href),
    [returnHere, here],
  )
  const currentId = order.find((item) => item.href !== null && isAtHref(item.href, pathname, searchParams))?.id ?? null

  const ownerOf = useCallback((item: InboxItemView) => (isOpenRequest(item) ? waiting : fresh), [waiting, fresh])
  const markRead = useCallback(
    (item: InboxItemView) => {
      if (!item.read) void ownerOf(item).markRead([item.id])
    },
    [ownerOf],
  )

  const rootRef = useRef<HTMLDivElement>(null)
  const archive = useCallback(
    (itemId: string) => {
      const links = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-testid="inbox-queue-entry"]') ?? [])]
      const at = links.findIndex((link) => link.getAttribute('data-item-id') === itemId)
      if (at >= 0 && links[at].closest('li')?.contains(document.activeElement)) {
        ;(links[at + 1] ?? links[at - 1])?.focus({ preventScroll: true })
      }
      setHeld((current) => (current?.item.id === itemId ? null : current))
      archiveLater.request(itemId)
      toast(t('inbox.archived'), {
        duration: ARCHIVE_UNDO_MS,
        action: { label: t('inbox.undo'), onClick: () => archiveLater.undo(itemId) },
      })
    },
    [archiveLater, t],
  )

  const onKey = useCallback(
    (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typingInto(event.target)) return
      if (!QUEUE_KEYS.has(event.key) || order.length === 0) return
      const links = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-testid="inbox-queue-entry"]') ?? [])]
      const at = links.findIndex((link) => link === document.activeElement)
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault()
        const step = event.key === 'j' ? 1 : -1
        const next = links[at < 0 ? (step > 0 ? 0 : links.length - 1) : Math.min(links.length - 1, Math.max(0, at + step))]
        next?.focus()
        next?.scrollIntoView?.({ block: 'nearest' })
        return
      }
      const item = at < 0 ? null : (order.find((entry) => entry.id === links[at].getAttribute('data-item-id')) ?? null)
      if (!item) return
      event.preventDefault()
      if (event.key === 'e') {
        archive(item.id)
        return
      }
      void (!item.read ? ownerOf(item).markRead([item.id]) : ownerOf(item).markUnread([item.id]))
    },
    [order, archive, ownerOf],
  )

  useEffect(() => {
    const listen = (event: KeyboardEvent): void => {
      const root = rootRef.current
      if (!root) return
      if (keyScope === 'self') {
        const scope = root.closest('[data-queue-keys]') ?? root
        if (event.target instanceof Node && scope.contains(event.target)) onKey(event)
        return
      }
      const scope = root.closest('[role="dialog"]') ?? document.body
      if (event.target instanceof Node && event.target !== document.body && !scope.contains(event.target)) return
      onKey(event)
    }
    window.addEventListener('keydown', listen)
    return () => window.removeEventListener('keydown', listen)
  }, [keyScope, onKey])

  const loading = waiting.loading || fresh.loading
  const late = groups.flatMap((group) => group.items).filter((item) => item.variant === 'overdue').length
  const waitingCount = groups.reduce((sum, group) => sum + group.items.length, 0)

  if ((waiting.error || fresh.error) && order.length === 0) {
    return <LoadError title={t('inbox.errors.loadFailed')} onRetry={() => (waiting.refresh(), fresh.refresh())} />
  }
  if (!loading && order.length === 0 && !waiting.hasMore && !fresh.hasMore) {
    return (
      <div ref={rootRef} data-testid="inbox-queue">
        {/* Arrives, like the list it follows: it used to replace it in one frame. */}
        <FadeIn distance={4}>
          <QueueDone />
        </FadeIn>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="space-y-3" data-testid="inbox-queue">
      {(waiting.mutationError || fresh.mutationError) && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle className="line-clamp-none">{t('inbox.errors.actionFailed')}</AlertTitle>
          <Button variant="secondary" size="sm" className="mt-2 w-fit" onClick={() => (waiting.dismissMutationError(), fresh.dismissMutationError())}>
            {t('sharing.errors.dismiss')}
          </Button>
        </Alert>
      )}

      {loading ? (
        <InboxQueueSkeleton />
      ) : (
        <FadeIn distance={4}>
          <InboxQueueList
            groups={groups}
            news={news}
            waitingCount={waitingCount}
            lateCount={late}
            currentId={currentId}
            hrefOf={hrefOf}
            onFollow={(event, item) => {
              if (!isPlainClick(event)) return
              markRead(item)
              if (!item.read && !isOpenRequest(item)) {
                setHeld({ item: { ...item, read: true, state: item.state === 'unread' ? 'read' : item.state }, at: news.indexOf(item), from: here })
              }
            }}
            onArchive={archive}
            onNewsRead={news.some((item) => !item.read) ? () => void fresh.markAllRead() : undefined}
            waitingMore={
              <LoadMore
                hasMore={waiting.hasMore}
                loading={waiting.loadingMore}
                failed={waiting.loadMoreFailed}
                onLoadMore={waiting.loadMore}
                loadMoreLabel={t('inbox.loadMore')}
                loadingLabel={t('inbox.loadingMore')}
                failedLabel={t('inbox.loadMoreFailed')}
              />
            }
            newsMore={
              <LoadMore
                hasMore={fresh.hasMore}
                loading={fresh.loadingMore}
                failed={fresh.loadMoreFailed}
                onLoadMore={fresh.loadMore}
                loadMoreLabel={t('inbox.loadMore')}
                loadingLabel={t('inbox.loadingMore')}
                failedLabel={t('inbox.loadMoreFailed')}
              />
            }
          />
        </FadeIn>
      )}
    </div>
  )
}

function QueueDone(): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const settle = useMotionToken(springSnap)
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center" data-testid="inbox-queue-done">
      <motion.span
        aria-hidden
        className="mb-1 flex size-10 items-center justify-center rounded-full bg-success-subtle text-success"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={settle}
      >
        <Check className="size-5" strokeWidth={2.25} />
      </motion.span>
      <p className="text-sm font-medium text-foreground">{t('inbox.empty.needsMeTitle')}</p>
      <p className="max-w-[30ch] text-sm text-muted-foreground">{t('inbox.empty.needsMeDescription')}</p>
    </div>
  )
}
