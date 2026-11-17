import 'server-only'
import { randomUUID } from 'node:crypto'
import type { EventTransport } from '@/lib/events/bus'
import { createRedisClient } from '@/lib/redis/connect.js'

export type HubListener = (payload: unknown) => void

const PROCESS_ID = randomUUID()

interface Topic {
  listeners: Set<HubListener>
  remote: Promise<(() => Promise<void>) | null>
}

const topics = new Map<string, Topic>()
const releasing = new Map<string, Promise<void>>()

let remote: EventTransport | null | undefined

function getRemote(): EventTransport | null {
  if (remote !== undefined) return remote
  const url = process.env.REDIS_URL
  try {
    remote = url ? new SharedRedisTransport(url) : null
  } catch (error) {
    console.warn('[realtime] no redis transport, staying in-process:', error)
    remote = null
  }
  return remote
}

function deliver(topic: Topic | undefined, payload: unknown): void {
  if (!topic) return
  for (const listener of [...topic.listeners]) {
    try {
      listener(payload)
    } catch (error) {
      console.warn('[realtime] listener threw:', error)
    }
  }
}

function onRemote(name: string, raw: string): void {
  let message: { origin?: unknown; payload?: unknown } | null = null
  try {
    message = JSON.parse(raw) as { origin?: unknown; payload?: unknown }
  } catch {
    return
  }
  if (!message || typeof message !== 'object' || message.origin === PROCESS_ID) return
  deliver(topics.get(name), message.payload)
}

export async function publish(topic: string, payload: unknown): Promise<void> {
  deliver(topics.get(topic), payload)
  const transport = getRemote()
  if (!transport) return
  try {
    await transport.publish(topic, JSON.stringify({ origin: PROCESS_ID, payload }))
  } catch (error) {
    console.warn('[realtime] publish failed (other replicas miss this one):', error)
  }
}

export function subscribe(name: string, listener: HubListener): () => void {
  let topic = topics.get(name)
  if (!topic) {
    const transport = getRemote()
    const after = releasing.get(name) ?? Promise.resolve()
    topic = {
      listeners: new Set(),
      remote: transport
        ? after
            .then(() => transport.subscribe(name, (raw) => onRemote(name, raw)))
            .catch((error: unknown) => {
              console.warn('[realtime] subscribe failed, this replica hears only itself:', error)
              return null
            })
        : Promise.resolve(null),
    }
    topics.set(name, topic)
  }
  const own = topic
  own.listeners.add(listener)
  let released = false
  return () => {
    if (released) return
    released = true
    own.listeners.delete(listener)
    if (own.listeners.size > 0 || topics.get(name) !== own) return
    topics.delete(name)
    const done = own.remote
      .then((release) => release?.())
      .catch((error: unknown) => console.warn('[realtime] unsubscribe failed:', error))
    releasing.set(name, done)
    void done.then(() => {
      if (releasing.get(name) === done) releasing.delete(name)
    })
  }
}

export function hubStats(): { topics: number; listeners: number } {
  let listeners = 0
  for (const topic of topics.values()) listeners += topic.listeners.size
  return { topics: topics.size, listeners }
}

export async function __setHubTransportForTests(next: EventTransport | null): Promise<void> {
  await Promise.all([...releasing.values()])
  topics.clear()
  releasing.clear()
  remote = next
}

export class SharedRedisTransport implements EventTransport {
  private readonly subscriber: RedisLike
  private readonly publisher: RedisLike
  private readonly handlers = new Map<string, Set<(payload: string) => void>>()

  constructor(url: string) {
    this.publisher = createClient(url)
    this.subscriber = createClient(url)
    this.subscriber.on('message', (channel: string, payload: string) => {
      for (const handler of this.handlers.get(channel) ?? []) {
        try {
          handler(payload)
        } catch (error) {
          console.warn('[realtime] redis handler threw:', error)
        }
      }
    })
  }

  async publish(channel: string, payload: string): Promise<void> {
    await this.publisher.publish(channel, payload)
  }

  async subscribe(channel: string, onMessage: (payload: string) => void): Promise<() => Promise<void>> {
    let set = this.handlers.get(channel)
    if (!set) {
      set = new Set()
      this.handlers.set(channel, set)
    }
    set.add(onMessage)
    if (set.size === 1) {
      try {
        await this.subscriber.subscribe(channel)
      } catch (error) {
        const current = this.handlers.get(channel)
        current?.delete(onMessage)
        if (current?.size === 0) this.handlers.delete(channel)
        throw error
      }
    }
    return async () => {
      const current = this.handlers.get(channel)
      if (!current?.delete(onMessage) || current.size > 0) return
      this.handlers.delete(channel)
      await this.subscriber.unsubscribe(channel)
    }
  }

  disconnect(): void {
    this.subscriber.disconnect()
    this.publisher.disconnect()
  }
}

interface RedisLike {
  on(event: string, listener: (...args: string[]) => void): unknown
  publish(channel: string, payload: string): Promise<unknown>
  subscribe(channel: string): Promise<unknown>
  unsubscribe(channel: string): Promise<unknown>
  disconnect(): void
}

function createClient(url: string): RedisLike {
  return createRedisClient(url, 'realtime', { commandTimeout: 2000, queueWhileDown: true }) as RedisLike
}
