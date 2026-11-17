import { browserPageLifecycle, isActive, type PageLifecycle } from '@/adapters/api/page-lifecycle'
import { createRetryLadder, type RetryLadder } from '@/shared/utils/backoff'
import {
  realtimeFrameSchema,
  realtimeStreamPath,
  REALTIME_SEND_PATH,
  type ChannelEvent,
  type RealtimeSelf,
} from '@/lib/realtime/types'

export type ChannelStatus = 'connecting' | 'live' | 'offline'

export interface ChannelHandlers {
  onEvent(event: ChannelEvent): void
  onWelcome?(self: RealtimeSelf): void
  onClosed?(reason: 'revoked' | 'unsupported'): void
  onStatus?(status: ChannelStatus): void
}

export interface ChannelPostOptions {
  motion?: boolean
}

export interface PostOutcome {
  status: number
  retryAfterMs: number
}

export interface RealtimeConnection {
  join(ch: string, handlers: ChannelHandlers): () => void
  send(ch: string, msg: unknown, options?: ChannelPostOptions): void
  status(ch: string): ChannelStatus
  dispose(): void
}

interface EventSourceLike {
  onopen: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent<string>) => void) | null
  close(): void
}

export interface ConnectionOptions {
  createSource?: (url: string) => EventSourceLike
  post?: (path: string, body: string, init: { keepalive: boolean }) => Promise<PostOutcome | undefined> | void
  debounceMs?: number
  ladder?: RetryLadder
  lifecycle?: PageLifecycle
}

const MAX_MOTION_PAUSE_MS = 60_000
const MIN_MOTION_PAUSE_MS = 1_000

const retryAfterMs = (header: string | null) => {
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 0
}

const defaultPost = (path: string, body: string, { keepalive }: { keepalive: boolean }) => {
  if (typeof fetch !== 'function') return
  return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive })
    .then((response): PostOutcome => ({ status: response.status, retryAfterMs: retryAfterMs(response.headers.get('retry-after')) }))
    .catch(() => undefined)
}

const isGone = (msg: unknown) =>
  typeof msg === 'object' && msg !== null && (msg as { presence?: unknown }).presence === 'gone'

const defaultSource = (url: string): EventSourceLike | null =>
  typeof EventSource === 'undefined' ? null : (new EventSource(url) as unknown as EventSourceLike)

export function createRealtimeConnection({
  createSource,
  post = defaultPost,
  debounceMs = 250,
  ladder = createRetryLadder({ baseMs: 1_000, maxMs: 30_000 }),
  lifecycle = browserPageLifecycle(),
}: ConnectionOptions = {}): RealtimeConnection {
  const joined = new Map<string, Set<ChannelHandlers>>()
  const dropped = new Set<string>()
  let source: EventSourceLike | null = null
  let carried = new Set<string>()
  let live = false
  let self: RealtimeSelf | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  const motionPausedUntil = new Map<string, number>()
  const heldMotion = new Map<string, unknown>()
  const heldTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const wanted = () => [...joined.keys()].filter((ch) => !dropped.has(ch)).sort()

  const status = (ch: string): ChannelStatus => {
    if (dropped.has(ch)) return 'offline'
    if (live && carried.has(ch)) return 'live'
    return source || debounce ? 'connecting' : 'offline'
  }

  const each = (ch: string, run: (handlers: ChannelHandlers) => void) => {
    for (const handlers of [...(joined.get(ch) ?? [])]) {
      try {
        run(handlers)
      } catch (error) {
        console.warn('[realtime] channel handler threw:', error)
      }
    }
  }
  const announceStatus = () => {
    for (const ch of joined.keys()) {
      const now = status(ch)
      each(ch, (handlers) => handlers.onStatus?.(now))
    }
  }

  const closeSource = () => {
    if (!source) return
    source.onopen = source.onerror = source.onmessage = null
    source.close()
    source = null
    live = false
  }

  const open = (): void => {
    const channels = wanted()
    closeSource()
    carried = new Set(channels)
    if (channels.length === 0) {
      ladder.reset()
      announceStatus()
      return
    }
    const next = (createSource ?? defaultSource)(realtimeStreamPath(channels))
    if (!next) {
      announceStatus()
      return
    }
    source = next
    next.onopen = () => {
      ladder.reset()
      live = true
      announceStatus()
    }
    next.onerror = () => {
      closeSource()
      announceStatus()
      if (wanted().length > 0 && isActive(lifecycle)) ladder.schedule(() => (isActive(lifecycle) ? open() : undefined))
    }
    next.onmessage = (message) => {
      let raw: unknown
      try {
        raw = JSON.parse(message.data)
      } catch {
        return
      }
      const parsed = realtimeFrameSchema.safeParse(raw)
      if (!parsed.success) return
      const frame = parsed.data
      if (frame.kind === 'welcome') {
        self = frame.self
        live = true
        for (const ch of carried) each(ch, (handlers) => handlers.onWelcome?.(frame.self))
        announceStatus()
      } else if (frame.kind === 'event') {
        if (carried.has(frame.ch)) each(frame.ch, (handlers) => handlers.onEvent(frame.event))
      } else {
        dropped.add(frame.ch)
        carried.delete(frame.ch)
        each(frame.ch, (handlers) => handlers.onClosed?.(frame.kind))
        each(frame.ch, (handlers) => handlers.onStatus?.('offline'))
        schedule()
      }
    }
    announceStatus()
  }

  const schedule = () => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      const now = wanted()
      const same = now.length === carried.size && now.every((ch) => carried.has(ch))
      if (same && source) return
      ladder.cancel()
      open()
    }, debounceMs)
  }

  const stopListening = lifecycle.subscribe({
    resume: () => {
      if (wanted().length === 0 || (source && live) || debounce) return
      ladder.reset()
      open()
    },
  })

  function send(ch: string, msg: unknown, { motion = false }: ChannelPostOptions = {}): void {
    const pausedUntil = motionPausedUntil.get(ch) ?? 0
    if (motion && pausedUntil > Date.now()) {
      heldMotion.set(ch, msg)
      if (!heldTimers.has(ch)) {
        heldTimers.set(
          ch,
          setTimeout(() => {
            heldTimers.delete(ch)
            const held = heldMotion.get(ch)
            heldMotion.delete(ch)
            if (held !== undefined && joined.has(ch)) send(ch, held, { motion: true })
          }, pausedUntil - Date.now())
        )
      }
      return
    }
    const outcome = post(REALTIME_SEND_PATH, JSON.stringify({ ch, msg }), { keepalive: isGone(msg) })
    if (!motion || !outcome) return
    void outcome.then((result) => {
      if (result?.status !== 429) return
      const pause = Math.min(MAX_MOTION_PAUSE_MS, Math.max(MIN_MOTION_PAUSE_MS, result.retryAfterMs))
      motionPausedUntil.set(ch, Date.now() + pause)
    })
  }

  return {
    join(ch, handlers) {
      let set = joined.get(ch)
      if (!set) {
        set = new Set()
        joined.set(ch, set)
        dropped.delete(ch)
        schedule()
      }
      set.add(handlers)
      handlers.onStatus?.(status(ch))
      if (live && self && carried.has(ch)) handlers.onWelcome?.(self)
      let left = false
      return () => {
        if (left) return
        left = true
        const current = joined.get(ch)
        if (!current?.delete(handlers) || current.size > 0) return
        joined.delete(ch)
        dropped.delete(ch)
        schedule()
      }
    },
    send,
    status,
    dispose() {
      stopListening()
      if (debounce) clearTimeout(debounce)
      debounce = null
      ladder.cancel()
      closeSource()
      joined.clear()
      dropped.clear()
      motionPausedUntil.clear()
      for (const timer of heldTimers.values()) clearTimeout(timer)
      heldTimers.clear()
      heldMotion.clear()
      carried = new Set()
    },
  }
}

let shared: RealtimeConnection | null = null

export function getRealtimeConnection(): RealtimeConnection {
  return (shared ??= createRealtimeConnection())
}

export function __resetRealtimeConnection(): void {
  shared?.dispose()
  shared = null
}
