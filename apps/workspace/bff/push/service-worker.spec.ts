// @disk-inputs: public/sw.js
/**
 * @vitest-environment node
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRODUCT_NAME } from '@/lib/brand'
import { LEGACY_WORKER_MESSAGES } from './legacy-worker-names'

const SW_PATH = join(process.cwd(), 'public', 'sw.js')
const sw = createRequire(import.meta.url)(SW_PATH) as {
  INBOX_TAG: string
  LEGACY_NAMES: { close: string; navigate: string; tag: string }
  MESSAGE_CLOSE: string
  MESSAGE_NAVIGATE: string
  notificationOptions: (m: ReturnType<typeof parse>) => Record<string, unknown>
  notificationsToClose: <T extends { tag: string }>(n: T[], r: unknown) => T[]
  parseMessage: (text: string | null) => { title: string; body: string; url: string; tag: string; itemId: string }
  pickWindow: (windows: unknown[], origin: string) => unknown
  register: (scope: object) => void
  safeTarget: (url: unknown, origin: string) => string
  urlBase64ToBytes: (value: string) => Uint8Array
}
const parse = sw.parseMessage
const ORIGIN = 'https://app.example.test'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the payload the server sends', () => {
  it('becomes a notification with its words, address and tag', () => {
    const message = parse(
      JSON.stringify({ version: 1, title: 'Anna hat geantwortet', body: 'in Atrium', url: '/app/inbox?x=1', tag: 'abc', itemId: 'i1' })
    )
    expect(message).toEqual({ title: 'Anna hat geantwortet', body: 'in Atrium', url: '/app/inbox?x=1', tag: 'abc', itemId: 'i1' })
    expect(sw.notificationOptions(message)).toMatchObject({
      body: 'in Atrium',
      tag: 'abc',
      renotify: true,
      data: { url: '/app/inbox?x=1', itemId: 'i1' },
    })
  })

  it('still shows something for a payload it cannot read (a browser demands a notification per push)', () => {
    for (const text of [null, '', 'not json', '[]', '"x"', '{"title":5}']) {
      const message = parse(text)
      expect(message.title).toBe(PRODUCT_NAME)
      expect(message.url).toBe('/app/inbox')
    }
  })

  it('is shown under the inbox tag when the payload names none', () => {
    expect(sw.INBOX_TAG).toBe('inbox')
    expect(parse(JSON.stringify({ title: 'x' })).tag).toBe('inbox')
  })
})

describe('the names the worker and the page both carry', () => {
  it('agrees with the page-side legacy module on the old message names', () => {
    expect(sw.LEGACY_NAMES.close).toBe(LEGACY_WORKER_MESSAGES.closeNotifications)
    expect(sw.LEGACY_NAMES.navigate).toBe(LEGACY_WORKER_MESSAGES.navigate)
  })

  it('sends and reads the new names', () => {
    expect(sw.MESSAGE_CLOSE).toBe('close-notifications')
    expect(sw.MESSAGE_NAVIGATE).toBe('navigate')
  })
})

describe('where a tap lands', () => {
  it.each([
    ['/app/projects/p1/chat?session=c1#m1', `${ORIGIN}/app/projects/p1/chat?session=c1#m1`],
    ['https://evil.example/', `${ORIGIN}/app/inbox`],
    ['//evil.example/x', `${ORIGIN}/app/inbox`],
    ['/\\evil.example', `${ORIGIN}/app/inbox`],
    ['', `${ORIGIN}/app/inbox`],
    [undefined, `${ORIGIN}/app/inbox`],
    [42, `${ORIGIN}/app/inbox`],
  ])('%s', (url, expected) => {
    expect(sw.safeTarget(url, ORIGIN)).toBe(expected)
  })

  it('prefers a focused window of ours, then a visible one, and never another site', () => {
    const other = { url: 'https://other.example/app', focused: true }
    const hidden = { url: `${ORIGIN}/app/a`, focused: false, visibilityState: 'hidden' }
    const visible = { url: `${ORIGIN}/app/b`, focused: false, visibilityState: 'visible' }
    const focused = { url: `${ORIGIN}/app/c`, focused: true, visibilityState: 'visible' }
    expect(sw.pickWindow([other, hidden, visible, focused], ORIGIN)).toBe(focused)
    expect(sw.pickWindow([other, hidden, visible], ORIGIN)).toBe(visible)
    expect(sw.pickWindow([other, hidden], ORIGIN)).toBe(hidden)
    expect(sw.pickWindow([other], ORIGIN)).toBeNull()
    expect(sw.pickWindow([], ORIGIN)).toBeNull()
  })
})

describe('closing notifications the page says are no longer news', () => {
  const shown = [
    { tag: 'a', data: { itemId: 'i-a' } },
    { tag: 'b', data: { itemId: 'i-b' } },
    { tag: 'c' },
  ]
  it('closes the named tags or items, all of them, or none', () => {
    expect(sw.notificationsToClose(shown, { tags: ['b'] })).toEqual([shown[1]])
    expect(sw.notificationsToClose(shown, { itemIds: ['i-a', 'i-unknown'] })).toEqual([shown[0]])
    expect(sw.notificationsToClose(shown, { all: true })).toEqual(shown)
    expect(sw.notificationsToClose(shown, {})).toEqual([])
    expect(sw.notificationsToClose(shown, null)).toEqual([])
  })

  it('closes the inbox tag under both its names, so a notification an older worker showed still closes', () => {
    const inbox = [{ tag: 'inbox' }, { tag: sw.LEGACY_NAMES.tag }, { tag: 'other' }]
    expect(sw.notificationsToClose(inbox, { tags: ['inbox'] })).toEqual([inbox[0], inbox[1]])
    expect(sw.notificationsToClose(inbox, { tags: [sw.LEGACY_NAMES.tag] })).toEqual([inbox[0], inbox[1]])
  })
})

describe('the application server key', () => {
  it('decodes URL-safe base64 to the bytes the browser wants', () => {
    expect(Array.from(sw.urlBase64ToBytes('AQID'))).toEqual([1, 2, 3])
    expect(Array.from(sw.urlBase64ToBytes('-_8'))).toEqual([251, 255])
  })
})

function boot(options: { windows?: unknown[]; fetchImpl?: (url: string, init?: Record<string, unknown>) => Promise<unknown> } = {}) {
  const listeners: Record<string, (event: Record<string, unknown>) => void> = {}
  const shown: Array<{ title: string; options: Record<string, unknown> }> = []
  const opened: string[] = []
  const notifications: Array<{ tag: string; close: ReturnType<typeof vi.fn> }> = []
  const fetchCalls: Array<{ url: string; init?: Record<string, unknown> }> = []
  const scope = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => {
      listeners[type] = listener
    },
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => options.windows ?? []),
      openWindow: vi.fn(async (url: string) => {
        opened.push(url)
      }),
    },
    registration: {
      showNotification: vi.fn(async (title: string, opts: Record<string, unknown>) => {
        shown.push({ title, options: opts })
      }),
      getNotifications: vi.fn(async () => notifications),
      pushManager: { subscribe: vi.fn() },
    },
  }
  vi.stubGlobal('fetch', async (url: string, init?: Record<string, unknown>) => {
    fetchCalls.push({ url, init })
    return options.fetchImpl ? options.fetchImpl(url, init) : { ok: false }
  })
  sw.register(scope)
  const fire = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve()
    listeners[type]?.({ ...event, waitUntil: (promise: Promise<unknown>) => (pending = promise) })
    await pending
  }
  return { listeners, scope, shown, opened, notifications, fetchCalls, fire }
}

describe('the registered worker', () => {
  it('has no fetch handler and never touches a cache', async () => {
    const touched: string[] = []
    vi.stubGlobal(
      'caches',
      new Proxy(
        {},
        {
          get: (_target, name) => {
            touched.push(String(name))
            return () => undefined
          },
        }
      )
    )
    const { listeners, fire, notifications } = boot()
    notifications.push({ tag: 'a', close: vi.fn() })
    await fire('install', {})
    await fire('activate', {})
    await fire('push', { data: null })
    await fire('message', { data: { type: 'close-notifications', all: true } })
    await fire('notificationclick', { notification: { close: vi.fn(), data: { url: '/app/inbox', itemId: 'item-1' } } })
    await fire('pushsubscriptionchange', {})
    expect(Object.keys(listeners).sort()).toEqual(
      ['activate', 'install', 'message', 'notificationclick', 'push', 'pushsubscriptionchange'].sort()
    )
    expect(listeners.fetch).toBeUndefined()
    expect(touched).toEqual([])
  })

  it('shows the notification for a push', async () => {
    const { fire, shown } = boot()
    await fire('push', {
      data: { text: () => JSON.stringify({ title: 'Anna hat geantwortet', body: 'in Atrium', url: '/app/inbox', tag: 't', itemId: 'i' }) },
    })
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ title: 'Anna hat geantwortet', options: { body: 'in Atrium', tag: 't', renotify: true } })
  })

  it('shows a generic notification for an empty push', async () => {
    const { fire, shown } = boot()
    await fire('push', { data: null })
    expect(shown).toHaveLength(1)
    expect(shown[0]?.title).toBe(PRODUCT_NAME)
  })

  it('takes an open tab to the item and focuses it', async () => {
    const client = {
      url: `${ORIGIN}/app/projects`,
      focused: false,
      visibilityState: 'visible',
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => ({})),
      postMessage: vi.fn(),
    }
    const { fire, opened } = boot({ windows: [client] })
    const close = vi.fn()
    await fire('notificationclick', { notification: { close, data: { url: '/app/projects/p1/chat?session=c1' } } })
    expect(close).toHaveBeenCalled()
    expect(client.focus).toHaveBeenCalled()
    expect(client.navigate).toHaveBeenCalledWith(`${ORIGIN}/app/projects/p1/chat?session=c1`)
    expect(opened).toEqual([])
  })

  it('marks the tapped item read, with the session’s cookie, before it takes the tab there', async () => {
    const order: string[] = []
    const client = {
      url: `${ORIGIN}/app/projects`,
      focused: true,
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => {
        order.push('navigate')
        return {}
      }),
      postMessage: vi.fn(),
    }
    const { fire, fetchCalls } = boot({
      windows: [client],
      fetchImpl: async () => {
        order.push('read')
        return { ok: true }
      },
    })
    await fire('notificationclick', { notification: { close: vi.fn(), data: { url: '/app/inbox', itemId: 'item-1' } } })
    expect(fetchCalls).toEqual([
      {
        url: '/api/inbox/read',
        init: expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ itemIds: ['item-1'] }) }),
      },
    ])
    expect(order).toEqual(['read', 'navigate'])
  })

  it('still opens the item when the read fails, or when the notification names no item', async () => {
    const client = { url: `${ORIGIN}/app`, focused: true, focus: vi.fn(async () => undefined), navigate: vi.fn(async () => ({})), postMessage: vi.fn() }
    const failing = boot({ windows: [client], fetchImpl: async () => Promise.reject(new Error('offline')) })
    await failing.fire('notificationclick', { notification: { close: vi.fn(), data: { url: '/app/inbox', itemId: 'item-1' } } })
    expect(client.navigate).toHaveBeenCalledTimes(1)

    const silent = boot({ windows: [client] })
    await silent.fire('notificationclick', { notification: { close: vi.fn(), data: { url: '/app/inbox' } } })
    expect(silent.fetchCalls).toEqual([])
    expect(client.navigate).toHaveBeenCalledTimes(2)
  })

  it('asks the page to route itself when the browser refuses to navigate it', async () => {
    const client = {
      url: `${ORIGIN}/app/projects`,
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => {
        throw new Error('not controlled')
      }),
      postMessage: vi.fn(),
    }
    const { fire } = boot({ windows: [client] })
    await fire('notificationclick', { notification: { close: vi.fn(), data: { url: '/app/inbox' } } })
    expect(client.postMessage).toHaveBeenCalledWith({ type: 'navigate', url: '/app/inbox' })
    expect(client.postMessage).toHaveBeenCalledWith({ type: LEGACY_WORKER_MESSAGES.navigate, url: '/app/inbox' })
  })

  it('opens a window when none is open, and never to a foreign address', async () => {
    const { fire, opened } = boot()
    await fire('notificationclick', { notification: { close: vi.fn(), data: { url: '/app/inbox' } } })
    await fire('notificationclick', { notification: { close: vi.fn(), data: { url: 'https://evil.example/' } } })
    expect(opened).toEqual([`${ORIGIN}/app/inbox`, `${ORIGIN}/app/inbox`])
  })

  it.each([
    ['the new message', 'close-notifications'],
    ['the old message, from a page one release old', LEGACY_WORKER_MESSAGES.closeNotifications],
  ])('closes the notifications the page names, from %s', async (_label, type) => {
    const { fire, notifications } = boot()
    notifications.push({ tag: 'a', close: vi.fn() }, { tag: 'b', close: vi.fn() })
    await fire('message', { data: { type, tags: ['a'] } })
    expect(notifications[0]?.close).toHaveBeenCalled()
    expect(notifications[1]?.close).not.toHaveBeenCalled()
  })

  it('ignores a message it does not know', async () => {
    const { fire, notifications } = boot()
    notifications.push({ tag: 'b', close: vi.fn() })
    await fire('message', { data: { type: 'something-else', all: true } })
    expect(notifications[0]?.close).not.toHaveBeenCalled()
  })

  it('subscribes again and tells the server which address replaced which', async () => {
    const created = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: vi.fn() }
    const harness = boot({
      fetchImpl: async (url) =>
        url.endsWith('/config')
          ? { ok: true, json: async () => ({ enabled: true, publicKey: 'AQID' }) }
          : { ok: true },
    })
    harness.scope.registration.pushManager.subscribe.mockResolvedValue(created)
    await harness.fire('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/old' } })
    expect(harness.scope.registration.pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true })
    )
    const post = harness.fetchCalls.find((call) => call.url === '/api/notifications/push/devices')
    expect(post?.init).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/new',
      keys: { p256dh: 'p', auth: 'a' },
      replaces: 'https://fcm.googleapis.com/fcm/send/old',
    })
  })

  it('does nothing when signed out (the config answers 401), and leaves no orphan subscription when the server refuses', async () => {
    const signedOut = boot({ fetchImpl: async () => ({ ok: false }) })
    await signedOut.fire('pushsubscriptionchange', {})
    expect(signedOut.scope.registration.pushManager.subscribe).not.toHaveBeenCalled()

    const created = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: {} }), unsubscribe: vi.fn(async () => true) }
    const refused = boot({
      fetchImpl: async (url) =>
        url.endsWith('/config') ? { ok: true, json: async () => ({ enabled: true, publicKey: 'AQID' }) } : { ok: false },
    })
    refused.scope.registration.pushManager.subscribe.mockResolvedValue(created)
    await refused.fire('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/old' } })
    expect(created.unsubscribe).toHaveBeenCalled()
  })

  it('claims nothing for a change that names no old subscription, and drops the new one', async () => {
    const fresh = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/fresh', keys: {} }), unsubscribe: vi.fn(async () => true) }
    const harness = boot({
      fetchImpl: async (url) =>
        url.endsWith('/config') ? { ok: true, json: async () => ({ enabled: true, publicKey: 'AQID' }) } : { ok: true },
    })
    await harness.fire('pushsubscriptionchange', { newSubscription: fresh })
    expect(harness.fetchCalls.find((call) => call.url === '/api/notifications/push/devices')).toBeUndefined()
    expect(harness.scope.registration.pushManager.subscribe).not.toHaveBeenCalled()
    expect(fresh.unsubscribe).toHaveBeenCalled()
  })
})
