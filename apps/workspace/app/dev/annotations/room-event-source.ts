import { ME, agentPeer, annaPeer, jakobPeer, lenaPeer, pt, region } from './fixtures'
import { proposeFindings } from './fake-annotation-api'
import type { Listener } from './room-broadcast'
import { CHANNEL, broadcast, sources } from './room-broadcast'

const jakobDraft = (s: number) => {
  const phase = s % 6
  if (phase > 3) return null
  const grow = Math.min(1, phase / 2.4)
  return { x: 0.558, y: 0.58, w: +(0.005 + 0.09 * grow).toFixed(4), h: +(0.005 + 0.23 * grow).toFixed(4) }
}

let started = false
function startRoom(withAgent: boolean) {
  if (started) return
  started = true
  const t0 = performance.now()
  const everyone = [annaPeer, jakobPeer, lenaPeer]
  for (const who of everyone) broadcast({ kind: 'presence', peer: who, state: 'here', ttlMs: 25_000 })
  setInterval(() => {
    for (const who of everyone) broadcast({ kind: 'presence', peer: who, state: 'here', ttlMs: 25_000 })
  }, 8_000)
  broadcast({ kind: 'viewport', peer: annaPeer, viewport: { page: 1, y: 0.45 }, selected: 'ann-1' })
  broadcast({ kind: 'viewport', peer: lenaPeer, viewport: { page: 2, y: 0.4 } })
  broadcast({ kind: 'cursor', peer: lenaPeer, tool: 'select', cursor: { page: 2, x: 0.42, y: 0.38 } })
  setInterval(() => {
    const s = (performance.now() - t0) / 1000
    const along = 0.18 + 0.28 * (0.5 + 0.5 * Math.sin(s * 0.55))
    broadcast({
      kind: 'cursor',
      peer: annaPeer,
      tool: 'select',
      cursor: { page: 1, x: along, y: 0.44 + 0.015 * Math.sin(s * 2.1) },
      chat: s % 12 > 7 ? 'Hier fehlt die Kote' : null,
    })
    const draft = jakobDraft(s)
    broadcast({
      kind: 'cursor',
      peer: jakobPeer,
      tool: 'region',
      cursor: draft
        ? { page: 1, x: draft.x + draft.w, y: draft.y + draft.h }
        : { page: 1, x: 0.62 + 0.03 * Math.cos(s * 0.9), y: 0.36 + 0.06 * Math.sin(s * 0.9) },
      draft,
    })
  }, 80)
  if (withAgent) {
    const piloti = agentPeer
    const corridor = { page: 1, ...region(50, 270, 570, 320) }
    broadcast({ kind: 'presence', peer: piloti, state: 'here', ttlMs: 25_000 })
    broadcast({ kind: 'activity', peer: piloti, state: 'reading', box: corridor, label: 'sieht sich den Gang an' })
    broadcast({ kind: 'cursor', peer: piloti, cursor: { page: 1, ...pt(300, 295) }, tool: 'select', label: 'Fluchtweg' })
    setTimeout(() => broadcast({ kind: 'highlight', peer: piloti, box: corridor, label: 'Breite nicht kotiert', ttlMs: 6_000 }), 900)
    setTimeout(() => broadcast({ kind: 'activity', peer: piloti, state: 'idle' }), 2400)
    setInterval(() => broadcast({ kind: 'presence', peer: piloti, state: 'here', ttlMs: 25_000 }), 8_000)
    setTimeout(proposeFindings, 2200)
  }
}

export class RoomEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  private readonly listener: Listener = (frame) => this.onmessage?.({ data: JSON.stringify(frame) })
  constructor(readonly url: string) {
    setTimeout(() => {
      this.onopen?.()
      this.listener({ kind: 'welcome', self: { ...ME, kind: 'person' } })
      const channels = new URL(url, window.location.origin).searchParams.getAll('ch')
      if (!channels.includes(CHANNEL)) return
      sources.add(this.listener)
      startRoom(new URLSearchParams(window.location.search).has('piloti'))
    }, 50)
  }
  close() {
    sources.delete(this.listener)
  }
}
