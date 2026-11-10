import { TextEncoder, TextDecoder } from 'util'
import { BroadcastChannel } from 'node:worker_threads'

globalThis.TextEncoder = TextEncoder
globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder

/**
 * `EventSource`, which jsdom does not implement.
 *
 * Needed by any test that renders a component subscribing to the live-event
 * channel — the inbox badge, the chat toolbar, anything using `useLiveEvents`.
 * Without it those renders throw `ReferenceError: EventSource is not defined`
 * from inside an effect, which surfaces as an unrelated-looking failure in a test
 * about navigation or layout.
 *
 * This was not needed before because the one such component defaulted its
 * feature prop to `false`, so the subscription never opened — which is to say the
 * absence of this polyfill was hiding the fact that no test had ever rendered the
 * badge in its enabled state.
 *
 * Inert on purpose: it connects to nothing and delivers nothing. A test that
 * cares about event DELIVERY should drive the hub directly rather than rely on a
 * global fake, so this stub only has to keep the effect from throwing.
 */
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

// MSW's WebSocket support constructs a BroadcastChannel when the module loads.
// Node has one, but a vm pool's DOM context starts without it.
if (typeof globalThis.BroadcastChannel === 'undefined') {
  globalThis.BroadcastChannel = BroadcastChannel as unknown as typeof globalThis.BroadcastChannel
}

// Under the vm pool a worker process runs many spec files, each in a context of
// its own, and `process.env` is the one piece of state they share: a spec that
// set a variable and never restored it handed it to whichever spec the worker
// ran next (`bff/audit/service.spec.ts` read another spec's APP_URL). Every spec
// file starts from the environment the worker started with.
const ENV_BASELINE = Symbol.for('vitest.env-baseline')
const shared = process as unknown as Record<symbol, Record<string, string | undefined> | undefined>
const baseline = (shared[ENV_BASELINE] ??= { ...process.env })
for (const name of Object.keys(process.env)) {
  if (!(name in baseline)) delete process.env[name]
}
for (const [name, value] of Object.entries(baseline)) {
  if (process.env[name] !== value) process.env[name] = value
}

// The DOM's classes are shared the same way: happy-dom is loaded once per
// worker, so `HTMLElement.prototype` is one object for every spec file the
// worker runs. A spec that patched `HTMLElement.prototype.scrollTo` and
// "restored" it by assigning what it read left an own property behind (the
// method it read was inherited from `Element`), and that shadowed every later
// file's `Element.prototype.scrollTo` spy: `intake-setup-view.spec.tsx` saw no
// scroll on CI's shard 6/8, never alone. Every spec file starts from the scroll
// methods the worker started with.
const DOM_BASELINE = Symbol.for('vitest.dom-scroll-baseline')
const SCROLL_METHODS = ['scroll', 'scrollBy', 'scrollTo', 'scrollIntoView'] as const
const prototypes = typeof globalThis.HTMLElement === 'undefined' ? [] : [globalThis.Element.prototype, globalThis.HTMLElement.prototype]
const domShared = shared as unknown as Record<symbol, Map<object, (PropertyDescriptor | undefined)[]> | undefined>
// Recorded the first time a file sees the prototype: a worker's first file may have no DOM.
const domBaseline = (domShared[DOM_BASELINE] ??= new Map())
for (const prototype of prototypes) {
  const descriptors = domBaseline.get(prototype)
  if (!descriptors) {
    domBaseline.set(prototype, SCROLL_METHODS.map((name) => Object.getOwnPropertyDescriptor(prototype, name)))
    continue
  }
  SCROLL_METHODS.forEach((name, index) => {
    const descriptor = descriptors[index]
    if (descriptor) Object.defineProperty(prototype, name, descriptor)
    else Reflect.deleteProperty(prototype, name)
  })
}
