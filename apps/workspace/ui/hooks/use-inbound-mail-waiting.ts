'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { ApiRequestError } from '@/adapters/api/api-error'
import { listInboundMails } from '@/adapters/api/inbound-mail-client'
import {
  INBOUND_MAIL_LIST_MAX_LIMIT,
  type InboundMailListQuery,
  type InboundMailListView,
} from '@/lib/inbound-mail/inbound-mail-wire'
import { waitingShownCount } from '@/features/inbound-mail/lib/quiet-mail'

export interface InboundMailListReader {
  list(projectId: string, query?: Partial<InboundMailListQuery>, signal?: AbortSignal): Promise<InboundMailListView>
}

const listReader: InboundMailListReader = { list: listInboundMails }

export interface InboundMailWaiting {
  count: number | null
  more: boolean
  stamp?: string | null
}

const UNKNOWN: InboundMailWaiting = { count: null, more: false, stamp: null }
const FRESH_MS = 30_000
export const WAITING_POLL_MS = 60_000

interface Entry {
  state: InboundMailWaiting
  readAt: number
  inflight: Promise<void> | null
  denied: boolean
  listeners: Set<() => void>
}

const entries = new Map<string, Entry>()

function entryFor(projectId: string): Entry {
  let entry = entries.get(projectId)
  if (!entry) {
    entry = { state: UNKNOWN, readAt: 0, inflight: null, denied: false, listeners: new Set() }
    entries.set(projectId, entry)
  }
  return entry
}

function read(projectId: string, client: InboundMailListReader, force = false): Promise<void> {
  const entry = entryFor(projectId)
  if (entry.denied) return Promise.resolve()
  if (entry.inflight) return entry.inflight
  if (!force && Date.now() - entry.readAt < FRESH_MS) return Promise.resolve()
  entry.inflight = client
    .list(projectId, { status: 'waiting', limit: INBOUND_MAIL_LIST_MAX_LIMIT })
    .then((page) => {
      const stamp = page.items.map((mail) => `${mail.id}@${mail.updatedAt}`).join(',')
      entry.state = { count: waitingShownCount(page.items), more: page.nextCursor !== null, stamp }
    })
    .catch((error: unknown) => {
      if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
        entry.denied = true
        entry.state = UNKNOWN
      }
    })
    .finally(() => {
      entry.readAt = Date.now()
      entry.inflight = null
      for (const listener of entry.listeners) listener()
    })
  return entry.inflight
}

export function refreshInboundMailWaiting(projectId: string, client: InboundMailListReader = listReader): Promise<void> {
  return read(projectId, client, true)
}

export function primeInboundMailWaiting(projectId: string, state: Omit<InboundMailWaiting, 'stamp'>): void {
  const entry = entryFor(projectId)
  entry.state = { ...state, stamp: entry.state.stamp ?? null }
  entry.readAt = Date.now()
  for (const listener of entry.listeners) listener()
}

export function useInboundMailWaiting(
  projectId: string | null,
  enabled: boolean,
  client: InboundMailListReader = listReader,
): InboundMailWaiting {
  const active = enabled && projectId !== null
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!active || !projectId) return () => {}
      const entry = entryFor(projectId)
      entry.listeners.add(listener)
      return () => entry.listeners.delete(listener)
    },
    [active, projectId],
  )
  const snapshot = useCallback(() => (active && projectId ? entryFor(projectId).state : UNKNOWN), [active, projectId])
  const state = useSyncExternalStore(subscribe, snapshot, () => UNKNOWN)

  useEffect(() => {
    if (!active || !projectId) return
    void read(projectId, client)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void read(projectId, client)
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void read(projectId, client, true)
    }, WAITING_POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [active, projectId, client])

  return state
}

export function useInboundMailWaitingShown(projectId: string | null): InboundMailWaiting {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!projectId) return () => {}
      const entry = entryFor(projectId)
      entry.listeners.add(listener)
      return () => entry.listeners.delete(listener)
    },
    [projectId],
  )
  const snapshot = useCallback(() => (projectId ? entryFor(projectId).state : UNKNOWN), [projectId])
  return useSyncExternalStore(subscribe, snapshot, () => UNKNOWN)
}

export function resetInboundMailWaitingForTests(): void {
  entries.clear()
}
