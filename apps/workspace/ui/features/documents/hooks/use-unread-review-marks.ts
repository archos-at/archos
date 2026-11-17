'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { InboxClient } from '@/lib/inbox/client'
import { useLiveEvents } from '@/features/collaboration/hooks/use-live-events'
import { readMarkNews } from '../lib/mark-news'

const NO_MARKS: ReadonlySet<string> = new Set()

export const MARK_NEWS_SETTLE_MS = 400

export const UNREAD_READ_DELAY_MS = 250

export function useUnreadReviewMarks({
  enabled,
  documentId,
  inbox,
  selectedId,
}: {
  enabled: boolean
  documentId: string
  inbox: InboxClient
  selectedId: string | null
}) {
  const [unread, setUnread] = useState<ReadonlySet<string>>(NO_MARKS)
  const unreadRead = useRef({ documentId, ticket: 0 })
  unreadRead.current.documentId = documentId
  const fetchUnread = useCallback(async () => {
    const ticket = ++unreadRead.current.ticket
    const ids = await inbox.unreadMarks(documentId).catch(() => null)
    if (!ids || unreadRead.current.ticket !== ticket || unreadRead.current.documentId !== documentId) return
    setUnread(new Set(ids))
  }, [documentId, inbox])
  useEffect(() => {
    if (!enabled) return
    const asked = unreadRead.current
    setUnread(NO_MARKS)
    void fetchUnread()
    return () => {
      asked.ticket += 1
    }
  }, [enabled, fetchUnread])
  const unreadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (unreadTimer.current) clearTimeout(unreadTimer.current)
    },
    []
  )
  const marksSetWatched = useRef(false)
  const readMarksSetNews = useCallback(() => {
    void inbox.markMarksSetRead(documentId).catch(() => undefined)
  }, [documentId, inbox])
  const readInbox = useCallback(() => {
    void fetchUnread()
    if (marksSetWatched.current) readMarksSetNews()
  }, [fetchUnread, readMarksSetNews])
  useLiveEvents({
    enabled,
    onEvent: (event) => {
      if (event.kind !== 'inbox.changed') return
      if (unreadTimer.current) clearTimeout(unreadTimer.current)
      unreadTimer.current = setTimeout(readInbox, UNREAD_READ_DELAY_MS)
    },
    onRefresh: readInbox,
  })

  const selectedHasNews = selectedId !== null && unread.has(selectedId)
  useEffect(() => {
    if (!enabled || !selectedId || !selectedHasNews) return
    const timer = setTimeout(() => {
      setUnread((current) => {
        const next = new Set(current)
        next.delete(selectedId)
        return next
      })
      readMarkNews(documentId, selectedId, inbox)
    }, MARK_NEWS_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [enabled, documentId, selectedId, selectedHasNews, inbox])
  const watchMarksSetNews = useCallback(() => {
    marksSetWatched.current = true
    readMarksSetNews()
    return () => {
      marksSetWatched.current = false
    }
  }, [readMarksSetNews])

  return { unread, watchMarksSetNews }
}
