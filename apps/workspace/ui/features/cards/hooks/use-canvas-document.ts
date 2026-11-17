'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { listAnnotations } from '@/lib/annotations/client'
import { roomEventSchema } from '@/lib/annotations/room-types'
import type { AnnotationView } from '@/lib/annotations/types'
import { MAX_CHANNELS_PER_CONNECTION } from '@/lib/realtime/types'
import type { ChannelStatus } from '@/features/realtime/connection'
import { realtimeLink } from '@/features/realtime/use-channel'
import { documentRoomChannel } from '@/features/documents/hooks/use-document-room'
import type { LastReply, LiveMark } from '../lib/canvas-activity'

export const CHANGE_DEBOUNCE_MS = 120

export const CARD_CHANNEL_BUDGET = MAX_CHANNELS_PER_CONNECTION / 2

const lastReplyOf = (annotation: AnnotationView): LastReply | null => {
  const newest = annotation.replies.reduce<AnnotationView['replies'][number] | null>(
    (latest, reply) => (latest === null || reply.createdAt >= latest.createdAt ? reply : latest),
    null
  )
  if (!newest) return null
  return {
    authorKind: newest.authorKind,
    authorName: newest.authorKind === 'piloti' ? null : newest.createdByName,
    body: newest.body,
  }
}

const liveOf = (annotation: AnnotationView): LiveMark => ({
  status: annotation.status,
  canEdit: annotation.canEdit,
  acceptedByName: annotation.acceptedByName,
  closedByName: annotation.closedByName,
  assigneeUserId: annotation.assigneeUserId,
  dueOn: annotation.dueOn,
  kind: annotation.kind,
  body: annotation.body,
  replyCount: annotation.replies.length,
  lastReply: lastReplyOf(annotation),
})

export interface LiveMarks {
  lookup: (annotationId: string) => LiveMark | 'gone' | undefined
  refresh: () => Promise<((annotationId: string) => LiveMark | 'gone') | null>
  adopt: (annotation: AnnotationView) => void
  forget: (annotationId: string) => void
  connected: boolean
  touched: number
}

type MarkMap = ReadonlyMap<string, LiveMark | 'gone'>

const lookupIn =
  (marks: MarkMap) =>
  (annotationId: string): LiveMark | 'gone' =>
    marks.get(annotationId) ?? 'gone'

interface DocumentMarks {
  list: MarkMap | null
  started: number
  applied: number
  reading: Promise<MarkMap | null> | null
  again: Promise<MarkMap | null> | null
  renders: Set<() => void>
  watchers: number
  since: number
  leave: (() => void) | null
  status: ChannelStatus | 'off'
  debounce: ReturnType<typeof setTimeout> | null
  pending: Set<string>
  touched: Map<string, number>
  touchedAll: number
  touchCount: number
  joinedBefore: boolean
}

const documents = new Map<string, DocumentMarks>()
let watchOrder = 0

function recordOf(documentId: string): DocumentMarks {
  let record = documents.get(documentId)
  if (!record) {
    record = {
      list: null,
      started: 0,
      applied: 0,
      reading: null,
      again: null,
      renders: new Set(),
      watchers: 0,
      since: 0,
      leave: null,
      status: 'off',
      debounce: null,
      pending: new Set(),
      touched: new Map(),
      touchedAll: 0,
      touchCount: 0,
      joinedBefore: false,
    }
    documents.set(documentId, record)
  }
  return record
}

const notify = (record: DocumentMarks) => {
  for (const render of [...record.renders]) render()
}

function prune(documentId: string, record: DocumentMarks): void {
  if (record.renders.size > 0 || record.watchers > 0 || record.reading) return
  if (documents.get(documentId) === record) documents.delete(documentId)
}

function startRead(documentId: string, record: DocumentMarks): Promise<MarkMap | null> {
  const ticket = ++record.started
  const reading = listAnnotations(documentId)
    .then((response) => {
      const next: MarkMap = new Map(response.annotations.map((annotation) => [annotation.id, liveOf(annotation)]))
      if (ticket > record.applied) {
        record.applied = ticket
        record.list = next
        notify(record)
      }
      return record.list
    })
    .catch(() => null)
    .finally(() => {
      if (record.reading === reading) record.reading = null
      prune(documentId, record)
    })
  record.reading = reading
  return reading
}

function readMarks(documentId: string, { fresh }: { fresh: boolean }): Promise<MarkMap | null> {
  const record = recordOf(documentId)
  if (!record.reading) return startRead(documentId, record)
  if (!fresh) return record.reading
  record.again ??= record.reading.then(() => {
    record.again = null
    return record.reading ?? startRead(documentId, record)
  })
  return record.again
}

function setStatus(record: DocumentMarks, status: DocumentMarks['status']): void {
  if (record.status === status) return
  record.status = status
  notify(record)
}

function onChanged(documentId: string, record: DocumentMarks, annotationIds: readonly string[]): void {
  for (const id of annotationIds) record.pending.add(id)
  if (record.debounce) clearTimeout(record.debounce)
  record.debounce = setTimeout(() => {
    record.debounce = null
    const stamp = ++record.touchCount
    for (const id of record.pending) record.touched.set(id, stamp)
    record.pending.clear()
    notify(record)
    void readMarks(documentId, { fresh: true })
  }, CHANGE_DEBOUNCE_MS)
}

function join(documentId: string, record: DocumentMarks): void {
  if (record.leave) return
  if (record.joinedBefore) record.touchedAll = ++record.touchCount
  record.joinedBefore = true
  setStatus(record, 'connecting')
  const link = realtimeLink(documentRoomChannel(documentId))
  record.leave = link.connect({
    onOpen: () => {
      if (record.status === 'offline') {
        record.touchedAll = ++record.touchCount
        void readMarks(documentId, { fresh: false })
      }
      setStatus(record, 'live')
    },
    onDrop: () => setStatus(record, 'offline'),
    onFrame: (frame) => {
      if (frame.kind === 'revoked') return setStatus(record, 'offline')
      if (frame.kind === 'welcome') return setStatus(record, 'live')
      const parsed = roomEventSchema.safeParse(frame.event)
      if (parsed.success && parsed.data.kind === 'annotations.changed') {
        onChanged(documentId, record, parsed.data.annotationIds)
      }
    },
  })
  void readMarks(documentId, { fresh: false })
}

function part(record: DocumentMarks): void {
  if (record.debounce) clearTimeout(record.debounce)
  record.debounce = null
  const leave = record.leave
  record.leave = null
  leave?.()
  setStatus(record, 'off')
}

function rebalance(): void {
  const watched = [...documents.entries()]
    .filter(([, record]) => record.watchers > 0)
    .sort(([, a], [, b]) => a.since - b.since)
  watched.forEach(([documentId, record], index) => {
    if (index < CARD_CHANNEL_BUDGET) join(documentId, record)
    else part(record)
  })
}

function watchDocument(documentId: string): () => void {
  const record = recordOf(documentId)
  if (record.watchers++ === 0) record.since = ++watchOrder
  rebalance()
  let left = false
  return () => {
    if (left) return
    left = true
    record.watchers -= 1
    if (record.watchers > 0) return
    part(record)
    rebalance()
    prune(documentId, record)
  }
}

function subscribeTo(documentId: string, render: () => void): () => void {
  const record = recordOf(documentId)
  record.renders.add(render)
  return () => {
    record.renders.delete(render)
    prune(documentId, record)
  }
}

const currentList = (documentId: string): MarkMap | null => documents.get(documentId)?.list ?? null
const isConnected = (documentId: string): boolean => documents.get(documentId)?.status === 'live'

function touchedStamp(documentId: string, annotationIds: readonly string[]): number {
  const record = documents.get(documentId)
  if (!record) return 0
  return annotationIds.reduce((newest, id) => Math.max(newest, record.touched.get(id) ?? 0), record.touchedAll)
}

export function __resetCanvasDocuments(): void {
  for (const record of documents.values()) part(record)
  documents.clear()
  watchOrder = 0
}

interface Writes {
  base: MarkMap | null
  marks: MarkMap
}

const NO_WRITES: Writes = { base: null, marks: new Map() }
const NO_MARKS: readonly string[] = []

export function useLiveMarks(
  documentId: string,
  { seen, onScreen, watch = NO_MARKS }: { seen: boolean; onScreen: boolean; watch?: readonly string[] }
): LiveMarks {
  const subscribe = useCallback((render: () => void) => subscribeTo(documentId, render), [documentId])
  const list = useSyncExternalStore(
    subscribe,
    () => currentList(documentId),
    () => null
  )
  const connected = useSyncExternalStore(
    subscribe,
    () => isConnected(documentId),
    () => false
  )
  const touched = useSyncExternalStore(
    subscribe,
    () => touchedStamp(documentId, watch),
    () => 0
  )
  const [writes, setWrites] = useState<Writes>(NO_WRITES)
  const since = writes.base === list ? writes.marks : NO_WRITES.marks

  useEffect(() => {
    if (seen) void readMarks(documentId, { fresh: false })
  }, [documentId, seen])

  useEffect(() => (onScreen ? watchDocument(documentId) : undefined), [documentId, onScreen])

  const refresh = useCallback(async () => {
    const next = await readMarks(documentId, { fresh: true })
    return next ? lookupIn(next) : null
  }, [documentId])

  const write = useCallback(
    (annotationId: string, mark: LiveMark | 'gone') => {
      const base = currentList(documentId)
      setWrites((previous) => ({
        base,
        marks: new Map(previous.base === base ? previous.marks : undefined).set(annotationId, mark),
      }))
    },
    [documentId]
  )

  const adopt = useCallback((annotation: AnnotationView) => write(annotation.id, liveOf(annotation)), [write])
  const forget = useCallback((annotationId: string) => write(annotationId, 'gone'), [write])

  const lookup = useCallback(
    (annotationId: string) => since.get(annotationId) ?? (list === null ? undefined : lookupIn(list)(annotationId)),
    [list, since]
  )

  return { lookup, refresh, adopt, forget, connected, touched }
}

export function useFirstPageThumbnail(documentId: string, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetch(`/api/documents/${encodeURIComponent(documentId)}/thumbnail`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const value = typeof body === 'object' && body !== null ? (body as { url?: unknown }).url : null
        if (!cancelled) setUrl(typeof value === 'string' ? value : null)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [documentId, enabled])

  return url
}
