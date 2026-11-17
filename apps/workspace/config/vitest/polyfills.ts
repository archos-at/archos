import { TextEncoder, TextDecoder } from 'util'
import { BroadcastChannel } from 'node:worker_threads'

globalThis.TextEncoder = TextEncoder
globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder

class InertEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  readonly CONNECTING = InertEventSource.CONNECTING
  readonly OPEN = InertEventSource.OPEN
  readonly CLOSED = InertEventSource.CLOSED

  readonly url: string
  readonly withCredentials = false
  readyState = InertEventSource.CONNECTING

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(url: string | URL) {
    this.url = String(url)
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return false
  }
  close(): void {
    this.readyState = InertEventSource.CLOSED
  }
}

if (typeof globalThis.EventSource === 'undefined') {
  globalThis.EventSource = InertEventSource as unknown as typeof globalThis.EventSource
}

if (typeof globalThis.BroadcastChannel === 'undefined') {
  globalThis.BroadcastChannel = BroadcastChannel as unknown as typeof globalThis.BroadcastChannel
}

const ENV_BASELINE = Symbol.for('vitest.env-baseline')
const shared = process as unknown as Record<symbol, Record<string, string | undefined> | undefined>
const baseline = (shared[ENV_BASELINE] ??= { ...process.env })
for (const name of Object.keys(process.env)) {
  if (!(name in baseline)) delete process.env[name]
}
for (const [name, value] of Object.entries(baseline)) {
  if (process.env[name] !== value) process.env[name] = value
}

const DOM_BASELINE = Symbol.for('vitest.dom-baseline')
const STUBBED_METHODS = ['scroll', 'scrollBy', 'scrollTo', 'scrollIntoView', 'getBoundingClientRect'] as const
const domShared = process as unknown as Record<symbol, Map<object, (PropertyDescriptor | undefined)[]> | undefined>
const domBaseline = (domShared[DOM_BASELINE] ??= new Map())
const prototypes = typeof globalThis.HTMLElement === 'undefined' ? [] : [globalThis.Element.prototype, globalThis.HTMLElement.prototype]
for (const prototype of prototypes) {
  const descriptors = domBaseline.get(prototype)
  if (!descriptors) {
    domBaseline.set(prototype, STUBBED_METHODS.map((name) => Object.getOwnPropertyDescriptor(prototype, name)))
    continue
  }
  STUBBED_METHODS.forEach((name, index) => {
    const descriptor = descriptors[index]
    if (descriptor) Object.defineProperty(prototype, name, descriptor)
    else Reflect.deleteProperty(prototype, name)
  })
}
