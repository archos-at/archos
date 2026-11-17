'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { inboxClient, type InboxClient } from '@/lib/inbox/client'
import type { InboxItemView, InboxListFilter, InboxListResponse } from '@/lib/inbox/types'
import { closeNotifications, setAppBadge, type CloseNotificationsRequest } from '@/lib/push/browser'
import { useLiveEvents } from './use-live-events'

export interface UseInboxBadgeResult {
  pending: number
  connected: boolean
  refresh: () => void
}

export function useInboxBadge(enabled: boolean, client: InboxClient = inboxClient): UseInboxBadgeResult {
  const [pending, setPending] = useState(0)

  const refresh = useCallback(async () => {
    if (!enabled) return
    try {
      const data = await client.summary()
      setPending(Math.max(0, data.pending ?? 0))
    } catch {
      // Keep the last known count. A failed poll must not blank the badge —
    }
  }, [enabled, client])

  const { connected } = useLiveEvents({
    enabled,
    onEvent: (event) => {
      if (event.kind !== 'inbox.changed') return
      if (event.pending >= 0) setPending(event.pending)
      else void refresh()
    },
    onRefresh: () => void refresh(),
  })

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (enabled) setAppBadge(pending)
  }, [enabled, pending])

  return { pending, connected, refresh: () => void refresh() }
}

export interface UseInboxListResult {
  items: InboxItemView[]
  pending: number
  counts: InboxListResponse['counts']
  loading: boolean
  error: boolean
  mutationError: boolean
  dismissMutationError: () => void
  mutating: boolean
  connected: boolean
  refresh: () => void
  hasMore: boolean
  loadingMore: boolean
  loadMoreFailed: boolean
  loadMore: () => void
  markRead: (itemIds: string[]) => Promise<void>
  markUnread: (itemIds: string[]) => Promise<void>
  markAllRead: () => Promise<void>
  archive: (itemId: string) => Promise<void>
  unarchive: (itemId: string) => Promise<boolean>
}

const NO_ITEMS: InboxItemView[] = []
const NO_COUNTS: InboxListResponse['counts'] = { requests: 0, unread: 0 }

export function useInboxList(
  enabled: boolean,
  filter: InboxListFilter,
  client: InboxClient = inboxClient
): UseInboxListResult {
  const [items, setItems] = useState<InboxItemView[]>([])
  const [loadedFilter, setLoadedFilter] = useState(filter)
  const loadedFilterRef = useRef(filter)
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])
  const [pending, setPending] = useState(0)
  const [counts, setCounts] = useState<InboxListResponse['counts']>(NO_COUNTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [mutationError, setMutationError] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const pagesRef = useRef(1)

  const requestSeq = useRef(0)

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }
    const seq = ++requestSeq.current
    try {
      const first = await client.list({ filter })
      let rows = first.items
      let next = first.hasMore ? first.nextCursor : null
      for (let page = 1; page < pagesRef.current && next; page++) {
        const older = await client.list({ filter, cursor: next })
        rows = [...rows, ...older.items]
        next = older.hasMore ? older.nextCursor : null
      }
      if (seq !== requestSeq.current) return
      const seen = new Set<string>()
      setItems(rows.filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true))))
      setLoadedFilter(filter)
      loadedFilterRef.current = filter
      setPending(Math.max(0, first.pending))
      setCounts(first.counts)
      setCursor(next)
      setError(false)
    } catch {
      if (seq !== requestSeq.current) return
      if (loadedFilterRef.current !== filter) {
        setItems([])
        setLoadedFilter(filter)
        loadedFilterRef.current = filter
      }
      setError(true)
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [enabled, filter, client])

  const { connected } = useLiveEvents({
    enabled,
    onEvent: (event) => {
      if (event.kind === 'inbox.changed') void refresh()
    },
    onRefresh: () => void refresh(),
  })

  useEffect(() => {
    setLoading(true)
    setCursor(null)
    setLoadMoreFailed(false)
    pagesRef.current = 1
    void refresh()
  }, [refresh])

  const loadMore = useCallback(async () => {
    if (!enabled || !cursor || loadingMore) return
    const seq = requestSeq.current
    setLoadingMore(true)
    setLoadMoreFailed(false)
    try {
      const data = await client.list({ filter, cursor })
      if (seq !== requestSeq.current) return
      pagesRef.current += 1
      setItems((current) => {
        const shown = new Set(current.map((item) => item.id))
        return [...current, ...data.items.filter((item) => !shown.has(item.id))]
      })
      setCursor(data.hasMore ? data.nextCursor : null)
    } catch {
      if (seq === requestSeq.current) setLoadMoreFailed(true)
    } finally {
      setLoadingMore(false)
    }
  }, [enabled, cursor, loadingMore, client, filter])

  const mutate = useCallback(
    async (run: () => Promise<unknown>, closes?: CloseNotificationsRequest): Promise<boolean> => {
      setMutating(true)
      setMutationError(false)
      try {
        await run()
        if (closes) void closeNotifications(closes).catch(() => undefined)
        await refresh()
        return true
      } catch {
        setMutationError(true)
        return false
      } finally {
        setMutating(false)
      }
    },
    [refresh],
  )

  const optimistic = useCallback(
    async (
      patch: (item: InboxItemView) => InboxItemView | null,
      ids: readonly string[] | 'all',
      run: () => Promise<unknown>,
      closes?: CloseNotificationsRequest,
    ): Promise<boolean> => {
      const before = itemsRef.current
      setItems((current) =>
        current.flatMap((item) => {
          if (ids !== 'all' && !ids.includes(item.id)) return [item]
          const next = patch(item)
          return next ? [next] : []
        })
      )
      const ok = await mutate(run, closes)
      if (!ok) setItems(before)
      return ok
    },
    [mutate],
  )

  const markRead = useCallback(
    async (itemIds: string[]) => {
      if (itemIds.length === 0) return
      await optimistic(
        (item) => ({ ...item, read: true, state: item.state === 'unread' ? 'read' : item.state }),
        itemIds,
        () => client.markRead(itemIds),
        { itemIds },
      )
    },
    [optimistic, client],
  )

  const markUnread = useCallback(
    async (itemIds: string[]) => {
      if (itemIds.length === 0) return
      await optimistic(
        (item) => ({ ...item, read: false, state: item.state === 'read' ? 'unread' : item.state }),
        itemIds,
        () => client.markUnread(itemIds),
      )
    },
    [optimistic, client],
  )

  const markAllRead = useCallback(async () => {
    await optimistic(
      (item) => (item.read ? item : { ...item, read: true, state: item.state === 'unread' ? 'read' : item.state }),
      'all',
      () => client.markAllRead(),
      { all: true },
    )
  }, [optimistic, client])

  const archive = useCallback(
    async (itemId: string) => {
      await optimistic(() => null, [itemId], () => client.archive(itemId), { itemIds: [itemId] })
    },
    [optimistic, client],
  )

  const unarchive = useCallback(
    async (itemId: string): Promise<boolean> => optimistic(() => null, [itemId], () => client.unarchive(itemId)),
    [optimistic, client],
  )

  const stale = loadedFilter !== filter
  return {
    items: stale ? NO_ITEMS : items,
    pending,
    counts,
    loading: loading || stale,
    error,
    mutationError,
    dismissMutationError: () => setMutationError(false),
    mutating,
    connected,
    refresh: () => void refresh(),
    hasMore: cursor !== null,
    loadingMore,
    loadMoreFailed,
    loadMore: () => void loadMore(),
    markRead,
    markUnread,
    markAllRead,
    archive,
    unarchive,
  }
}
