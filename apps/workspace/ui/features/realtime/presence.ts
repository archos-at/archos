import type { RealtimePeer } from '@/lib/realtime/types'

export interface RosterEntry<S> {
  peer: RealtimePeer
  expiresAt: number
  state: S
}

export interface RosterOptions<E, S> {
  selfPeerId: string
  refreshMs: number
  leaseMs?: number
  initial(peer: RealtimePeer): S
  reduce(state: S, event: E): S | null
  say(state: 'here' | 'gone'): void
  onChange(): void
  random?: () => number
  now?: () => number
}

export type PeerEvent = { kind: string; peer?: RealtimePeer; state?: unknown; ttlMs?: unknown }

const ANSWER_SPREAD_MS = 350
const ANSWER_MIN_MS = 150
const PRUNE_MS = 2_000

export function createRoster<E extends PeerEvent, S>(options: RosterOptions<E, S>) {
  const { selfPeerId, refreshMs, initial, reduce, say, onChange, random = Math.random, now = Date.now } = options
  const leaseMs = options.leaseMs ?? refreshMs * 2
  const peers = new Map<string, RosterEntry<S>>()
  let answer: ReturnType<typeof setTimeout> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let prune: ReturnType<typeof setInterval> | null = null
  let leave: (() => void) | null = null

  const answerStranger = () => {
    answer ??= setTimeout(
      () => {
        answer = null
        say('here')
      },
      ANSWER_MIN_MS + random() * ANSWER_SPREAD_MS
    )
  }

  const observe = (event: E): boolean => {
    const { peer } = event
    if (!peer) return false
    if (peer.peerId === selfPeerId) return true
    const known = peers.get(peer.peerId)
    if (event.kind === 'presence') {
      if (event.state === 'gone') {
        if (peers.delete(peer.peerId)) onChange()
        return true
      }
      if (!known && peer.kind === 'person') answerStranger()
      const ttl = typeof event.ttlMs === 'number' ? event.ttlMs : leaseMs
      peers.set(peer.peerId, { peer, state: known?.state ?? initial(peer), expiresAt: now() + ttl })
      onChange()
      return true
    }
    if (!known && peer.kind === 'person') answerStranger()
    const next = reduce(known?.state ?? initial(peer), event)
    if (next === null) peers.delete(peer.peerId)
    else peers.set(peer.peerId, { peer, state: next, expiresAt: Math.max(known?.expiresAt ?? 0, now() + leaseMs) })
    onChange()
    return true
  }

  return {
    observe,
    hello: () => say('here'),
    start() {
      heartbeat ??= setInterval(() => say('here'), refreshMs)
      prune ??= setInterval(() => {
        const at = now()
        let changed = false
        for (const [id, entry] of peers) {
          if (entry.expiresAt >= at) continue
          peers.delete(id)
          changed = true
        }
        if (changed) onChange()
      }, PRUNE_MS)
      if (!leave && typeof window !== 'undefined') {
        leave = () => say('gone')
        window.addEventListener('pagehide', leave)
      }
    },
    stop() {
      if (heartbeat) clearInterval(heartbeat)
      if (prune) clearInterval(prune)
      if (answer) clearTimeout(answer)
      heartbeat = prune = answer = null
      if (leave) window.removeEventListener('pagehide', leave)
      leave = null
      say('gone')
      peers.clear()
    },
    clear() {
      if (peers.size === 0) return
      peers.clear()
      onChange()
    },
    entries: (): RosterEntry<S>[] => [...peers.values()],
    get size() {
      return peers.size
    },
  }
}

export type Roster<E extends PeerEvent, S> = ReturnType<typeof createRoster<E, S>>
