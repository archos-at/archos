import { z } from 'zod'
import { AGENT_KINDS } from '@/lib/agent-kind'

export const MAX_CHANNELS_PER_CONNECTION = 8

export const channelKeySchema = z
  .string()
  .max(160)
  .regex(/^[a-z][a-z0-9-]{0,31}:[A-Za-z0-9_-]{1,128}$/)
export type ChannelKey = z.infer<typeof channelKeySchema>

export function channelKind(key: string): string | null {
  const parsed = channelKeySchema.safeParse(key)
  return parsed.success ? key.slice(0, key.indexOf(':')) : null
}

export const realtimePeerSchema = z.object({
  peerId: z.string().min(8).max(64),
  userId: z.string(),
  name: z.string(),
  kind: z.enum(['person', ...AGENT_KINDS] as const),
  forName: z.string().min(1).max(120).optional(),
})
export type RealtimePeer = z.infer<typeof realtimePeerSchema>

export const realtimeSelfSchema = realtimePeerSchema.omit({ peerId: true, forName: true })
export type RealtimeSelf = z.infer<typeof realtimeSelfSchema>

export const PRESENCE_STATES = ['here', 'gone'] as const
export type PresenceState = (typeof PRESENCE_STATES)[number]

export const presenceEventSchema = z.object({
  kind: z.literal('presence'),
  peer: realtimePeerSchema,
  state: z.enum(PRESENCE_STATES),
  ttlMs: z.number().int().positive(),
})
export type PresenceEvent = z.infer<typeof presenceEventSchema>

export const upstreamBaseSchema = z.object({
  peerId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  presence: z.enum(PRESENCE_STATES).optional(),
})
export type UpstreamBase = z.infer<typeof upstreamBaseSchema>

export const sendBodySchema = z.object({ ch: channelKeySchema, msg: z.unknown() }).strict()
export type SendBody = z.infer<typeof sendBodySchema>

export const channelEventSchema = z.object({ kind: z.string().min(1) }).passthrough()
export type ChannelEvent = z.infer<typeof channelEventSchema>

export const realtimeFrameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('welcome'), self: realtimeSelfSchema }),
  z.object({ kind: z.literal('event'), ch: channelKeySchema, event: channelEventSchema }),
  z.object({ kind: z.literal('revoked'), ch: channelKeySchema }),
  z.object({ kind: z.literal('unsupported'), ch: channelKeySchema }),
])
export type RealtimeFrame = z.infer<typeof realtimeFrameSchema>

export function realtimeStreamPath(channels: readonly string[]): string {
  const query = new URLSearchParams()
  for (const ch of channels) query.append('ch', ch)
  return `/api/realtime?${query.toString()}`
}

export const REALTIME_SEND_PATH = '/api/realtime/send'
