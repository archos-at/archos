import { z } from 'zod'
import { realtimePeerSchema, realtimeSelfSchema, upstreamBaseSchema } from '@/lib/realtime/types'

export const PRESENCE_TTL_MS = 25_000
export const PRESENCE_REFRESH_MS = 10_000
export const CURSOR_INTERVAL_MS = 80
export const VIEWPORT_INTERVAL_MS = 200

const unit = z.number().finite().min(0).max(1)

export const CURSOR_CHAT_MAX = 140

export const roomPeerSchema = realtimePeerSchema
export type RoomPeer = z.infer<typeof roomPeerSchema>

export const ROOM_TOOLS = ['select', 'point', 'region'] as const
export type RoomTool = (typeof ROOM_TOOLS)[number]

export const roomCursorSchema = z.object({ page: z.number().int().min(1), x: unit, y: unit })
export type RoomCursor = z.infer<typeof roomCursorSchema>

export const roomViewportSchema = z.object({ page: z.number().int().min(1), y: unit })
export type RoomViewport = z.infer<typeof roomViewportSchema>

const boxShape = { x: unit, y: unit, w: unit, h: unit }
export const roomDraftSchema = z.object(boxShape)
export type RoomDraft = z.infer<typeof roomDraftSchema>
export const roomBoxSchema = z.object({ page: z.number().int().min(1), ...boxShape })
export type RoomBox = z.infer<typeof roomBoxSchema>

const draftField = roomDraftSchema.nullable().optional()
const chatField = z.string().trim().max(CURSOR_CHAT_MAX).nullable().optional()
const selectedField = z.string().min(1).max(64).nullable().optional()
const labelField = z.string().trim().min(1).max(CURSOR_CHAT_MAX).optional()

export const HIGHLIGHT_TTL_MS = 6_000

export const roomPostSchema = upstreamBaseSchema
  .extend({
    cursor: roomCursorSchema.nullable().optional(),
    viewport: roomViewportSchema.optional(),
    tool: z.enum(ROOM_TOOLS).optional(),
    draft: draftField,
    chat: chatField,
    selected: selectedField,
  })
  .strict()
export type RoomPost = z.infer<typeof roomPostSchema>

export const AGENT_ACTIVITY_STATES = ['reading', 'idle'] as const
export type AgentActivityState = (typeof AGENT_ACTIVITY_STATES)[number]

export const ANNOTATION_CHANGES = ['created', 'updated', 'deleted', 'replied'] as const
export type AnnotationChange = (typeof ANNOTATION_CHANGES)[number]

export const roomEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('presence'),
    peer: roomPeerSchema,
    state: z.enum(['here', 'gone']),
    ttlMs: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('cursor'),
    peer: roomPeerSchema,
    cursor: roomCursorSchema.nullable(),
    tool: z.enum(ROOM_TOOLS).optional(),
    draft: draftField,
    chat: chatField,
    label: labelField,
  }),
  z.object({
    kind: z.literal('viewport'),
    peer: roomPeerSchema,
    viewport: roomViewportSchema.optional(),
    selected: selectedField,
  }),
  z.object({
    kind: z.literal('activity'),
    peer: roomPeerSchema,
    state: z.enum(AGENT_ACTIVITY_STATES),
    box: roomBoxSchema.optional(),
    label: labelField,
  }),
  z.object({
    kind: z.literal('highlight'),
    peer: roomPeerSchema,
    box: roomBoxSchema,
    label: labelField,
    ttlMs: z.number().int().positive().max(60_000),
  }),
  z.object({
    kind: z.literal('annotations.changed'),
    annotationIds: z.array(z.string()).min(1),
    change: z.enum(ANNOTATION_CHANGES),
    actor: roomPeerSchema.omit({ peerId: true }).extend({ peerId: z.string().nullable() }),
  }),
])
export type RoomEvent = z.infer<typeof roomEventSchema>

export type RoomActivity = Extract<RoomEvent, { kind: 'activity' }>
export type RoomHighlight = Extract<RoomEvent, { kind: 'highlight' }>

export const roomFrameSchema = z.union([
  z.object({ kind: z.literal('event'), event: roomEventSchema }),
  z.object({ kind: z.literal('welcome'), self: realtimeSelfSchema }),
  z.object({ kind: z.literal('revoked') }),
])
export type RoomFrame = z.infer<typeof roomFrameSchema>
