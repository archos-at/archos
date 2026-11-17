import 'server-only'
import { parse as legacyParse } from 'node:url'
import webpush, { type PushSubscription } from 'web-push'
import type { PushUrgency } from '@/lib/inbox/push-categories'
import type { WebPushConfig } from './config'
import { isPushServiceEndpoint } from './endpoint'

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushSendOptions {
  ttlSeconds: number
  urgency: PushUrgency
  topic: string
}

export type PushSendOutcome =
  | { kind: 'delivered' }
  | { kind: 'gone' }
  | { kind: 'rejected'; status: number }
  | { kind: 'transient'; status: number | null }

export interface PushSender {
  send(target: PushTarget, payload: string, options: PushSendOptions): Promise<PushSendOutcome>
}

const SEND_TIMEOUT_MS = 10_000

export function outcomeForStatus(status: number): PushSendOutcome {
  if (status >= 200 && status < 300) return { kind: 'delivered' }
  if (status === 404 || status === 410) return { kind: 'gone' }
  if (status === 429 || status >= 500) return { kind: 'transient', status }
  return { kind: 'rejected', status }
}

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const status = (error as { statusCode?: unknown }).statusCode
  return typeof status === 'number' ? status : null
}

export function isSendableEndpoint(endpoint: string): boolean {
  if (!isPushServiceEndpoint(endpoint)) return false
  return legacyParse(endpoint).hostname === new URL(endpoint).hostname
}

export function createWebPushSender(config: WebPushConfig, lib: typeof webpush = webpush): PushSender {
  const vapidDetails = { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey }
  return {
    async send(target, payload, options) {
      if (!isSendableEndpoint(target.endpoint)) return { kind: 'gone' }
      const subscription: PushSubscription = {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      }
      try {
        const result = await lib.sendNotification(subscription, payload, {
          TTL: options.ttlSeconds,
          urgency: options.urgency,
          topic: options.topic,
          vapidDetails,
          timeout: SEND_TIMEOUT_MS,
        })
        return outcomeForStatus(result.statusCode)
      } catch (error) {
        const status = statusOf(error)
        return status === null ? { kind: 'transient', status: null } : outcomeForStatus(status)
      }
    },
  }
}
