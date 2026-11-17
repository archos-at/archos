import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetEventHub,
  subscribeToEvents,
  type CollaborationEvent,
} from './event-hub'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.closed = true
  }

  emit(data: string): void {
    this.onmessage?.({ data })
  }

  deliver(event: unknown): void {
    this.emit(JSON.stringify({ id: 'evt_1', at: 1_700_000_000_000, event }))
  }
}

function live(): FakeEventSource {
  return FakeEventSource.instances[FakeEventSource.instances.length - 1]
}

const inboxChanged: CollaborationEvent = { kind: 'inbox.changed', pending: 3 }

describe('event hub', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    __resetEventHub()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('opens one connection for any number of subscribers and fans out to all of them', () => {
    const badge = vi.fn()
    const list = vi.fn()
    const thread = vi.fn()
    subscribeToEvents(badge)
    subscribeToEvents(list)
    subscribeToEvents(thread)

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(live().url).toBe('/api/stream')

    live().deliver(inboxChanged)
    for (const listener of [badge, list, thread]) {
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(inboxChanged)
    }
  })

  it('holds the connection until the last subscriber leaves, then drops it', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribeToEvents(first)
    const unsubscribeSecond = subscribeToEvents(second)

    unsubscribeFirst()
    expect(live().closed).toBe(false)
    live().deliver(inboxChanged)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()

    unsubscribeSecond()
    expect(live().closed).toBe(true)

    subscribeToEvents(vi.fn())
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(live().closed).toBe(false)
  })

  it('backs off between reconnects instead of hammering the route', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(1) // top of the jitter window
    subscribeToEvents(vi.fn())

    live().onerror?.()
    expect(live().closed).toBe(true)
    vi.advanceTimersByTime(1_999)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(2)

    live().onerror?.()
    vi.advanceTimersByTime(3_999)
    expect(FakeEventSource.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(3)
  })

  it('forgets an outage the connection has since recovered from', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(1)
    subscribeToEvents(vi.fn())

    for (let attempt = 0; attempt < 5; attempt += 1) {
      live().onerror?.()
      vi.advanceTimersByTime(60_000)
    }

    const atCap = FakeEventSource.instances.length
    live().onerror?.()
    vi.advanceTimersByTime(2_000)
    expect(FakeEventSource.instances).toHaveLength(atCap)
    vi.advanceTimersByTime(28_000)
    expect(FakeEventSource.instances).toHaveLength(atCap + 1)

    live().onopen?.()
    const recovered = FakeEventSource.instances.length
    live().onerror?.()
    vi.advanceTimersByTime(2_000)
    expect(FakeEventSource.instances).toHaveLength(recovered + 1)
  })

  it('drops a malformed frame without taking the connection down', () => {
    const listener = vi.fn()
    subscribeToEvents(listener)
    const source = live()

    source.emit('<html>502 Bad Gateway</html>')
    source.emit(JSON.stringify({ id: 'evt_1', at: 1 })) // envelope, no event
    source.deliver({ pending: 1 }) // event, no discriminator
    source.deliver(null)

    expect(listener).not.toHaveBeenCalled()
    expect(source.closed).toBe(false)
    expect(FakeEventSource.instances).toHaveLength(1)

    source.deliver(inboxChanged)
    expect(listener).toHaveBeenCalledWith(inboxChanged)
  })
})
