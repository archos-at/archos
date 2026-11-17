'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CURSOR_CHAT_MAX,
  CURSOR_INTERVAL_MS,
  PRESENCE_REFRESH_MS,
  roomEventSchema,
  VIEWPORT_INTERVAL_MS,
  type AgentActivityState,
  type RoomBox,
  type RoomCursor,
  type RoomDraft,
  type RoomHighlight,
  type RoomEvent,
  type RoomFrame,
  type RoomPeer,
  type RoomPost,
  type RoomTool,
  type RoomViewport,
} from '@/lib/annotations/room-types'
import type { ChannelPostOptions, ChannelStatus } from '@/features/realtime/connection'
import type { RosterEntry } from '@/features/realtime/presence'
import {
  createSnapshotStore,
  realtimeLink,
  sameItems,
  useChannel,
  useSnapshot,
  useStoreSelector,
  type ChannelLink,
  type SnapshotStore,
} from '@/features/realtime/use-channel'

export interface RoomTransport {
  connect(handlers: { onFrame: (frame: RoomFrame) => void; onOpen: () => void; onDrop: () => void }): () => void
  post(post: RoomPost, options?: ChannelPostOptions): void
}

export const documentRoomChannel = (documentId: string) => `doc:${documentId}`

export function sseRoomTransport(documentId: string): RoomTransport {
  const link = realtimeLink<RoomPost>(documentRoomChannel(documentId))
  return {
    connect: ({ onFrame, onOpen, onDrop }) =>
      link.connect({
        onOpen,
        onDrop,
        onFrame: (frame) => {
          if (frame.kind !== 'event') return onFrame(frame)
          const parsed = roomEventSchema.safeParse(frame.event)
          if (parsed.success) onFrame({ kind: 'event', event: parsed.data })
        },
      }),
    post: (post, options) => link.post(post, options),
  }
}

export interface RoomActivityState {
  state: AgentActivityState
  box: RoomBox | null
  label: string | null
}

export interface RoomHighlightState {
  box: RoomHighlight['box']
  label: string | null
  expiresAt: number
}

export interface RoomPeerState {
  peer: RoomPeer
  cursor: RoomCursor | null
  movedAt: number | null
  tool: RoomTool
  viewport: RoomViewport | null
  draft: RoomDraft | null
  chat: string | null
  label: string | null
  selected: string | null
  activity: RoomActivityState | null
  highlight: RoomHighlightState | null
  expiresAt: number
}

export type RoomStatus = ChannelStatus

type PeerFields = Omit<RoomPeerState, 'peer' | 'expiresAt'>

const NOBODY: PeerFields = {
  cursor: null,
  movedAt: null,
  tool: 'select',
  viewport: null,
  draft: null,
  chat: null,
  label: null,
  selected: null,
  activity: null,
  highlight: null,
}

const ALONE_INTERVAL_MS = 1_000

export function reduceRoomPeer(state: PeerFields, event: RoomEvent): PeerFields | null {
  switch (event.kind) {
    case 'cursor':
      return {
        ...state,
        cursor: event.cursor,
        movedAt: event.cursor ? Date.now() : state.movedAt,
        tool: event.tool ?? state.tool,
        draft: event.draft !== undefined ? event.draft : state.draft,
        chat: event.chat !== undefined ? event.chat || null : state.chat,
        label: event.label ?? null,
      }
    case 'viewport':
      return {
        ...state,
        viewport: event.viewport ?? state.viewport,
        selected: event.selected !== undefined ? event.selected : state.selected,
      }
    case 'activity':
      if (event.state === 'idle') return { ...state, activity: null }
      return { ...state, activity: { state: event.state, box: event.box ?? null, label: event.label ?? null } }
    case 'highlight':
      return { ...state, highlight: { box: event.box, label: event.label ?? null, expiresAt: Date.now() + event.ttlMs } }
    default:
      return state
  }
}

const ROOM_PRESENCE = {
  refreshMs: PRESENCE_REFRESH_MS,
  initial: (): PeerFields => NOBODY,
  reduce: reduceRoomPeer,
}

const parseRoomEvent = (value: unknown): RoomEvent | null => {
  const parsed = roomEventSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

type AnnotationsChanged = Extract<RoomEvent, { kind: 'annotations.changed' }>

export interface AgentHighlight {
  page: number
  x: number
  y: number
  w: number
  h: number
  label: string | null
}

export const HIGHLIGHT_MS = 6_000

export function agentHighlightOf(state: RoomPeerState, now = Date.now()): AgentHighlight | null {
  if (state.peer.kind !== 'piloti') return null
  if (state.highlight && state.highlight.expiresAt > now) {
    return { ...state.highlight.box, label: state.highlight.label }
  }
  const box = state.activity?.box
  return box ? { ...box, label: state.activity?.label ?? null } : null
}

export type ShownHighlight = AgentHighlight & { key: string; peerId: string }

export function createHighlightTracker() {
  const store = createSnapshotStore<readonly ShownHighlight[]>([])
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let signature = ''
  return {
    store: store as SnapshotStore<readonly ShownHighlight[]>,
    update(peers: readonly RoomPeerState[]) {
      const arrived = peers.flatMap((state) => {
        const highlight = agentHighlightOf(state)
        if (!highlight) return []
        const key = `${state.peer.peerId}:${highlight.page}:${highlight.x}:${highlight.y}:${highlight.w}:${highlight.h}:${highlight.label ?? ''}`
        return [{ ...highlight, key, peerId: state.peer.peerId }]
      })
      const next = arrived.map((highlight) => highlight.key).join('|')
      if (next === signature) return
      signature = next
      if (arrived.length === 0) return
      const before = store.get()
      store.set([
        ...before.filter((old) => !arrived.some((fresh) => fresh.peerId === old.peerId)),
        ...arrived.filter((fresh) => !before.some((old) => old.key === fresh.key)),
        ...before.filter((old) => arrived.some((fresh) => fresh.key === old.key)),
      ])
      for (const highlight of arrived) {
        if (timers.has(highlight.key)) continue
        timers.set(
          highlight.key,
          setTimeout(() => {
            timers.delete(highlight.key)
            store.set(store.get().filter((old) => old.key !== highlight.key))
          }, HIGHLIGHT_MS)
        )
      }
    },
    stop() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      signature = ''
      store.set([])
    },
  }
}

export function roomPeersOf(
  roster: SnapshotStore<readonly RosterEntry<PeerFields>[]>
): SnapshotStore<readonly RoomPeerState[]> {
  const flat = new WeakMap<RosterEntry<PeerFields>, RoomPeerState>()
  let source: readonly RosterEntry<PeerFields>[] | null = null
  let peers: readonly RoomPeerState[] = []
  return {
    get() {
      const entries = roster.get()
      if (entries === source) return peers
      source = entries
      peers = entries.map((entry) => {
        const known = flat.get(entry)
        if (known) return known
        const state: RoomPeerState = { peer: entry.peer, expiresAt: entry.expiresAt, ...entry.state }
        flat.set(entry, state)
        return state
      })
      return peers
    },
    subscribe: roster.subscribe,
  }
}

export function useDocumentRoom(
  documentId: string,
  { enabled, transport }: { enabled: boolean; transport?: RoomTransport }
) {
  const link = useMemo<ChannelLink>(() => {
    const room = transport ?? sseRoomTransport(documentId)
    return {
      connect: (handlers) => room.connect(handlers),
      post: (msg, options) => room.post(msg as RoomPost, options),
    }
  }, [transport, documentId])
  const listeners = useRef(new Set<(event: AnnotationsChanged) => void>())
  const pointer = useRef<{ cursor: RoomCursor | null; tool: RoomTool; draft: RoomDraft | null; chat: string | null }>({
    cursor: null,
    tool: 'select',
    draft: null,
    chat: null,
  })

  const onEvent = useCallback((event: RoomEvent) => {
    if (event.kind !== 'annotations.changed') return
    for (const listener of [...listeners.current]) listener(event)
  }, [])

  const channel = useChannel<RoomEvent, PeerFields>(documentRoomChannel(documentId), {
    enabled,
    link,
    parse: parseRoomEvent,
    onEvent,
    presence: ROOM_PRESENCE,
  })
  const { send } = channel

  const { roster } = channel
  const peers = useMemo(() => roomPeersOf(roster), [roster])
  const [highlights] = useState(createHighlightTracker)
  useEffect(() => {
    const update = () => highlights.update(peers.get())
    update()
    const unsubscribe = peers.subscribe(update)
    return () => {
      unsubscribe()
      highlights.stop()
    }
  }, [peers, highlights])

  const { peerCount } = channel
  const company = useCallback(() => peerCount((peer) => peer.kind === 'person') > 0, [peerCount])
  const aloneSent = useRef({ pointer: '', viewport: '' })
  const view = useRef<{ viewport: RoomViewport | null; selected: string | null }>({ viewport: null, selected: null })

  const pushPointer = useCallback(() => {
    const { cursor, tool, draft, chat } = pointer.current
    const message = { cursor, tool, draft, chat }
    if (company()) {
      aloneSent.current.pointer = ''
      send(message, { throttleMs: CURSOR_INTERVAL_MS, lane: 'cursor' })
      return
    }
    const summary = JSON.stringify([cursor?.page ?? null, tool, draft, chat])
    if (summary === aloneSent.current.pointer) return
    aloneSent.current.pointer = summary
    send(message, { throttleMs: ALONE_INTERVAL_MS, lane: 'cursor-alone' })
  }, [company, send])

  const sendCursor = useCallback(
    (cursor: RoomCursor | null, tool: RoomTool = pointer.current.tool) => {
      pointer.current = { ...pointer.current, cursor, tool, draft: cursor ? pointer.current.draft : null }
      pushPointer()
    },
    [pushPointer]
  )

  const sendDraft = useCallback(
    (draft: RoomDraft | null) => {
      pointer.current = { ...pointer.current, draft }
      pushPointer()
    },
    [pushPointer]
  )

  const sendChat = useCallback(
    (text: string | null) => {
      const chat = text?.trim().slice(0, CURSOR_CHAT_MAX) || null
      pointer.current = { ...pointer.current, chat }
      pushPointer()
    },
    [pushPointer]
  )

  const sendViewport = useCallback(
    (viewport: RoomViewport) => {
      view.current = { ...view.current, viewport }
      if (company()) {
        aloneSent.current.viewport = ''
        send({ viewport }, { throttleMs: VIEWPORT_INTERVAL_MS, lane: 'viewport' })
        return
      }
      const summary = `${viewport.page}:${Math.round(viewport.y * 10)}`
      if (summary === aloneSent.current.viewport) return
      aloneSent.current.viewport = summary
      send({ viewport }, { throttleMs: ALONE_INTERVAL_MS, lane: 'viewport-alone' })
    },
    [company, send]
  )

  const sendSelection = useCallback(
    (annotationId: string | null) => {
      if (view.current.selected === annotationId) return
      view.current = { ...view.current, selected: annotationId }
      send({ selected: annotationId })
    },
    [send]
  )

  const onAnnotationsChanged = useCallback((listener: (event: AnnotationsChanged) => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const { peerId, status, self } = channel
  return useMemo(
    () => ({
      peerId,
      status,
      self,
      peers,
      highlights: highlights.store,
      sendCursor,
      sendViewport,
      sendDraft,
      sendChat,
      sendSelection,
      onAnnotationsChanged,
    }),
    [peerId, status, self, peers, highlights, sendCursor, sendViewport, sendDraft, sendChat, sendSelection, onAnnotationsChanged]
  )
}

export type DocumentRoom = ReturnType<typeof useDocumentRoom>

export const useRoomPeers = (room: Pick<DocumentRoom, 'peers'>): readonly RoomPeerState[] => useSnapshot(room.peers)

export const useRoomSelector = <R,>(
  room: Pick<DocumentRoom, 'peers'>,
  select: (peers: readonly RoomPeerState[]) => R,
  equal?: (a: R, b: R) => boolean
): R => useStoreSelector(room.peers, select, equal)

export const usePeersOnPage = (room: Pick<DocumentRoom, 'peers'>, page: number): readonly RoomPeerState[] =>
  useStoreSelector(room.peers, (peers) => peers.filter((state) => state.cursor?.page === page), sameItems)
