import type { PushClient } from './client'
import { LEGACY_WORKER_MESSAGES } from './legacy-worker-names'
import type { PushDeviceView } from './types'

export type PushSupport = 'unsupported' | 'needs-install' | 'denied' | 'default' | 'granted'

export interface PushCapabilities {
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
  permission: NotificationPermission | null
  isIos: boolean
  isStandalone: boolean
}

interface CapabilityEnvironment {
  navigator?: Navigator & { standalone?: boolean }
  window?: Window & typeof globalThis
  notification?: typeof Notification
}

export function readCapabilities(env: CapabilityEnvironment = browserEnvironment()): PushCapabilities {
  const nav = env.navigator
  const win = env.window
  const ua = nav?.userAgent ?? ''
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1)
  const isStandalone =
    nav?.standalone === true || (win?.matchMedia?.('(display-mode: standalone)').matches ?? false)
  return {
    hasServiceWorker: Boolean(nav && 'serviceWorker' in nav),
    hasPushManager: Boolean(win && 'PushManager' in win),
    hasNotification: Boolean(env.notification),
    permission: env.notification ? env.notification.permission : null,
    isIos,
    isStandalone,
  }
}

function browserEnvironment(): CapabilityEnvironment {
  if (typeof window === 'undefined') return {}
  return {
    navigator,
    window,
    notification: typeof Notification === 'undefined' ? undefined : Notification,
  }
}

export function classifyPushSupport(caps: PushCapabilities): PushSupport {
  if (caps.isIos && !caps.isStandalone) return 'needs-install'
  if (!caps.hasServiceWorker || !caps.hasPushManager || !caps.hasNotification) return 'unsupported'
  if (caps.permission === 'denied') return 'denied'
  return caps.permission === 'granted' ? 'granted' : 'default'
}

export function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey
  if (!current) return false
  const bytes = new Uint8Array(current)
  return bytes.length === key.length && bytes.every((value, index) => value === key[index])
}

export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
  } catch {
    return null
  }
}

function workerRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(undefined)
  return navigator.serviceWorker.getRegistration('/').catch(() => undefined)
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const registration = await workerRegistration()
    return (await registration?.pushManager.getSubscription()) ?? null
  } catch {
    return null
  }
}

export async function subscribeThisDevice(publicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new PushPermissionError(permission)
  const registration = (await registerWorker()) ?? (await navigator.serviceWorker.ready)
  await navigator.serviceWorker.ready
  const key = urlBase64ToBytes(publicKey)
  const existing = await registration.pushManager.getSubscription()
  if (existing && sameKey(existing, key)) return existing
  if (existing) await existing.unsubscribe()
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}

export class PushPermissionError extends Error {
  constructor(readonly permission: NotificationPermission) {
    super(`notification permission is ${permission}`)
    this.name = 'PushPermissionError'
  }
}

export function registrationBody(subscription: PushSubscription): {
  endpoint: string
  keys: { p256dh: string; auth: string }
} {
  const json = subscription.toJSON()
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  }
}

export function deviceOfSubscription(
  devices: readonly PushDeviceView[],
  subscription: PushSubscription | null
): PushDeviceView | null {
  return subscription ? (devices.find((device) => device.endpoint === subscription.endpoint) ?? null) : null
}

export async function forgetThisDevice(
  client: Pick<PushClient, 'listDevices' | 'removeDevice'>,
  options: { serverWithinMs?: number } = {}
): Promise<void> {
  const registration = await workerRegistration()
  setAppBadge(0)
  if (!registration) return
  await closeShown(registration)
  const subscription = await registration.pushManager.getSubscription().catch(() => null)
  if (!subscription) return
  const { endpoint } = subscription
  await subscription.unsubscribe().catch(() => false)
  const server = removeServerDevice(client, endpoint)
  if (options.serverWithinMs === undefined) return server
  await Promise.race([server, new Promise<void>((resolve) => setTimeout(resolve, options.serverWithinMs))])
}

async function closeShown(registration: ServiceWorkerRegistration): Promise<void> {
  try {
    for (const notification of await registration.getNotifications()) notification.close()
  } catch {
    // A browser without the Notifications API on the registration shows none.
  }
}

async function removeServerDevice(
  client: Pick<PushClient, 'listDevices' | 'removeDevice'>,
  endpoint: string
): Promise<void> {
  try {
    const device = (await client.listDevices()).find((entry) => entry.endpoint === endpoint)
    if (device) await client.removeDevice(device.id)
  } catch {
    // the next send to the endpoint answers 410 and the row goes then.
  }
}

export type CloseNotificationsRequest = { itemIds: string[] } | { all: true }

export async function closeNotifications(request: CloseNotificationsRequest): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration('/')
  const worker = registration?.active
  worker?.postMessage({ type: 'close-notifications', ...request })
  worker?.postMessage({ type: LEGACY_WORKER_MESSAGES.closeNotifications, ...request })
}

export function setAppBadge(count: number): void {
  if (typeof navigator === 'undefined') return
  const badging = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  const call = count > 0 ? badging.setAppBadge?.(count) : badging.clearAppBadge?.()
  void call?.catch(() => undefined)
}
