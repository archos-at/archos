import 'server-only'
import { getAccessibleDocument } from '@/lib/documents/access'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { ROOM_CLAIM_LIMIT, ROOM_LIMIT } from '@/lib/limits'
import {
  CURSOR_CHAT_MAX,
  HIGHLIGHT_TTL_MS,
  PRESENCE_REFRESH_MS,
  PRESENCE_TTL_MS,
  roomEventSchema,
  roomPostSchema,
  type AgentActivityState,
  type RoomBox,
  type RoomCursor,
  type RoomEvent,
  type RoomPeer,
} from '@/lib/annotations/room-types'
import { defineChannel } from './channel'
import { publish } from './hub'
import { flushRoster, forgetRosterPeer, noteRosterPeer, readRoster, rosterKey, type RosterEntry, type RosterFacts } from './roster'
import { PRODUCT_NAME } from '@/lib/brand'

export const DOCUMENT_REAUTHORIZE_MS = 30_000

const LEASE_MS = PRESENCE_REFRESH_MS * 2

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/

export const documentChannelKey = (documentId: string) => `doc:${documentId}`

export const documentRoomTopic = (documentId: string) => `rt:doc:${documentId}`

function observeRoom(documentId: string, organizationId: string, events: ReadonlyArray<{ kind: string }>): void {
  const key = rosterKey(organizationId, documentChannelKey(documentId))
  for (const raw of events) {
    const event = raw as RoomEvent
    if (event.kind === 'annotations.changed') continue
    if (event.kind === 'presence') {
      if (event.state === 'gone') forgetRosterPeer(key, event.peer.peerId)
      else noteRosterPeer(key, event.peer, event.ttlMs)
      continue
    }
    const facts: RosterFacts = {}
    if (event.kind === 'cursor') {
      facts.page = event.cursor?.page ?? null
      if (event.draft !== undefined || !event.cursor) {
        facts.draft = event.cursor && event.draft ? { page: event.cursor.page, ...event.draft } : null
      }
    } else if (event.kind === 'viewport') {
      if (event.viewport) facts.viewport = event.viewport
      if (event.selected !== undefined) facts.selected = event.selected
    }
    noteRosterPeer(key, event.peer, LEASE_MS, facts)
  }
}

export const documentChannel = defineChannel({
  kind: 'doc',
  parse: (id) => (DOCUMENT_ID.test(id) ? { documentId: id } : null),
  topics: ({ documentId }) => [documentRoomTopic(documentId)],
  authorize: async (session, { documentId }) => {
    await getAccessibleDocument(session, documentId, 'read')
  },
  reauthorizeMs: DOCUMENT_REAUTHORIZE_MS,
  events: roomEventSchema,
  presence: { ttlMs: PRESENCE_TTL_MS, refreshMs: PRESENCE_REFRESH_MS },
  upstream: {
    schema: roomPostSchema,
    limit: ROOM_LIMIT,
    claims: { limit: ROOM_CLAIM_LIMIT, fields: ['selected'] },
    handle: (post, peer) => {
      const events: RoomEvent[] = []
      if (post.cursor !== undefined) {
        events.push({
          kind: 'cursor',
          peer,
          cursor: post.cursor,
          tool: post.tool,
          ...(post.draft !== undefined ? { draft: post.cursor ? post.draft : null } : {}),
          ...(post.chat !== undefined ? { chat: post.chat || null } : {}),
        })
      }
      if (post.viewport || post.selected !== undefined) {
        events.push({
          kind: 'viewport',
          peer,
          ...(post.viewport ? { viewport: post.viewport } : {}),
          ...(post.selected !== undefined ? { selected: post.selected } : {}),
        })
      }
      return events
    },
  },
  observe: (events, { documentId }, organizationId) => observeRoom(documentId, organizationId, events),
})

export async function publishToDocumentRoom(documentId: string, event: RoomEvent): Promise<void> {
  await publish(documentRoomTopic(documentId), event)
}

export function agentPeer(conversationId: string, onBehalfOf: string, forName?: string | null): RoomPeer {
  const id = conversationId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 56)
  const name = forName?.trim().slice(0, 120)
  return {
    peerId: `piloti-${id}`.padEnd(8, '0'),
    userId: onBehalfOf,
    name: PRODUCT_NAME,
    kind: 'piloti',
    ...(name ? { forName: name } : {}),
  }
}

async function actingName(organizationId: string, userId: string): Promise<string | null> {
  const directory = await loadOrganizationDirectory(organizationId).catch(() => null)
  return directory?.get(userId)?.name ?? null
}

export type AgentRoomOp =
  | { op: 'presence'; state: 'here' | 'gone' }
  | { op: 'cursor'; cursor: RoomCursor | null; label?: string }
  | { op: 'activity'; label?: string; state?: AgentActivityState; box?: RoomBox }
  | { op: 'highlight'; box: RoomBox; label?: string; ttlMs?: number }

const label = (text: string | undefined) => {
  const trimmed = text?.trim().slice(0, CURSOR_CHAT_MAX)
  return trimmed ? { label: trimmed } : {}
}

export function agentRoomEvent(peer: RoomPeer, op: AgentRoomOp): RoomEvent {
  const event: RoomEvent =
    op.op === 'presence'
      ? { kind: 'presence', peer, state: op.state, ttlMs: PRESENCE_TTL_MS }
      : op.op === 'cursor'
        ? { kind: 'cursor', peer, cursor: op.cursor, tool: 'select', ...label(op.label) }
        : op.op === 'activity'
          ? { kind: 'activity', peer, state: op.state ?? 'reading', ...(op.box ? { box: op.box } : {}), ...label(op.label) }
          : { kind: 'highlight', peer, box: op.box, ttlMs: op.ttlMs ?? HIGHLIGHT_TTL_MS, ...label(op.label) }
  return roomEventSchema.parse(event)
}

export async function publishAsAgent(
  documentId: string,
  organizationId: string,
  agent: { conversationId: string; onBehalfOf: string },
  op: AgentRoomOp
): Promise<RoomEvent> {
  const forName = await actingName(organizationId, agent.onBehalfOf)
  const event = agentRoomEvent(agentPeer(agent.conversationId, agent.onBehalfOf, forName), op)
  await publishToDocumentRoom(documentId, event)
  observeRoom(documentId, organizationId, [event])
  return event
}

export interface RoomSnapshotPeer {
  peerId: string
  userId: string
  name: string
  kind: 'person' | 'piloti'
  forName?: string
  page: number | null
  viewport: { page: number; y: number } | null
  selected: string | null
  draft: { page: number; x: number; y: number; w: number; h: number } | null
  expiresAt: string
}

const toSnapshotPeer = (entry: RosterEntry): RoomSnapshotPeer => ({
  peerId: entry.peer.peerId,
  userId: entry.peer.userId,
  name: entry.peer.name,
  kind: entry.peer.kind,
  ...(entry.peer.forName ? { forName: entry.peer.forName } : {}),
  page: entry.page,
  viewport: entry.viewport,
  selected: entry.selected,
  draft: entry.draft,
  expiresAt: new Date(entry.expiresAt).toISOString(),
})

export async function roomSnapshot(documentId: string, organizationId: string): Promise<RoomSnapshotPeer[]> {
  await flushRoster()
  const entries = await readRoster(rosterKey(organizationId, documentChannelKey(documentId)))
  return entries.map(toSnapshotPeer)
}
