import 'server-only'
import { createRedisClient } from '@/lib/redis/connect.js'

export interface ConversationFrame {
  payload: Record<string, unknown>
}

const WIRE_VERSION = 2

function conversationChannel(conversationId: string): string {
  return `conv:${conversationId}:events`
}

const FRAME = 'frame'
const TURN_END = 'turn_end'

export function conversationFramesAvailable(): boolean {
  return Boolean(process.env.REDIS_URL)
}

export function decodeConversationFrame(raw: string): ConversationFrame | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const envelope = parsed as { type?: unknown; payload?: unknown }
  if (envelope.type !== FRAME && envelope.type !== TURN_END) return null
  const payload = envelope.payload
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  if ((payload as { v?: unknown }).v !== WIRE_VERSION) return null
  return { payload: payload as Record<string, unknown> }
}

export async function subscribeConversationFrames(
  conversationId: string,
  onFrame: (frame: ConversationFrame) => void,
): Promise<(() => Promise<void>) | null> {
  const url = process.env.REDIS_URL
  if (!url) return null

  const channel = conversationChannel(conversationId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any
  try {
    client = createSubscriberClient(url)
    await client.subscribe(channel)
  } catch (error) {
    console.warn('[conversation-frames] subscribe failed:', error)
    try {
      client?.disconnect()
    } catch {
      // Nothing to do; we are already on the failure path.
    }
    return null
  }

  client.on('message', (_channel: string, raw: string) => {
    const frame = decodeConversationFrame(raw)
    if (!frame) return
    try {
      onFrame(frame)
    } catch (error) {
      console.warn('[conversation-frames] subscriber threw:', error)
    }
  })

  return async () => {
    try {
      await client.unsubscribe(channel)
    } catch {
      // Best effort — we are tearing down anyway.
    }
    try {
      client.disconnect()
    } catch {
      // Same.
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createSubscriberClient(url: string): any {
  return createRedisClient(url, 'conversation-frames', { commandTimeout: 2000 })
}

function conversationStream(conversationId: string): string {
  return `conv:${conversationId}:stream`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let peekClient: any = null

export async function peekNewestConversationFrame(
  conversationId: string,
): Promise<string | null | undefined> {
  const url = process.env.REDIS_URL
  if (!url) return undefined
  try {
    peekClient ??= createCommandClient(url)
    const entries: [string, string[]][] = await peekClient.xrevrange(
      conversationStream(conversationId),
      '+',
      '-',
      'COUNT',
      1,
    )
    return entries[0]?.[0] ?? null
  } catch (error) {
    console.warn('[conversation-frames] peek failed:', error)
    return undefined
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createCommandClient(url: string): any {
  return createRedisClient(url, 'conversation-frames', { commandTimeout: 2000, queueWhileDown: true })
}
